import BucketClientInterface from '../metadata/bucketclient/backend';
import BucketFileInterface from '../metadata/bucketfile/backend';
import BucketInfo from '../metadata/BucketInfo';
import inMemory from '../metadata/in_memory/backend';
import config from '../Config';
import async from 'async';
import bitmap from 'node-bitmap-ewah';

let client;
let implName;

if (config.backends.metadata === 'mem') {
    client = inMemory;
    implName = 'memorybucket';
} else if (config.backends.metadata === 'file') {
    client = new BucketFileInterface();
    implName = 'bucketfile';
} else if (config.backends.metadata === 'scality') {
    client = new BucketClientInterface();
    implName = 'bucketclient';
}

const index = {
    processQueryHeader: (header) => {
        if (!header)
            return header;
        const queryTerms = header.split("&");
        const query = [];
        for (let i=0; i<queryTerms.length; i++) {
            if (queryTerms[i].indexOf("op/NOT") === -1)
                query.push(queryTerms[i]);
            else {
                query.push(queryTerms[i]+"&"+queryTerms[i+1]);
                i+=1;
            }
        }
        return query;
    },

    evaluateQuery: (queryTerms, bucketName, log, cb, params) => {
        async.map(queryTerms, getObjects.bind(null, {bucketName, log, cb}), function(err, query){
            while(query.length > 1) {
                let operatorPos = -1;
                for(let i = query.length-1; i>=0; i--) {
                    if (query[i] === "op/AND" || query[i] === "op/OR") {
                        operatorPos = i;
                        break;
                    }
                }
                if (query[operatorPos] === "op/AND")
                    query.splice(operatorPos, 3, query[operatorPos+1].and(query[operatorPos+2]));
                else if (query[operatorPos] === "op/OR")
                    query.splice(operatorPos, 3, query[operatorPos+1].or(query[operatorPos+2]));
            }
        constructResponse(query[0], bucketName, log, cb, params);
        });
    },

    initRowIds: (bucketName, log, cb) => {
        client.putObject(bucketName, "I|objNameToRowID", JSON.stringify({}), log, err => {
            if (err)
                return cb(err);
            client.putObject(bucketName, "I|TagIndex", JSON.stringify({counter:0}), log, err => {
                if (err)
                    return cb(err);
                return cb(err);
            });
        });
    },

    updateRowIds: (bucketName, objName, objVal, log, cb) => {
        if (objName.indexOf("..|..") !== -1)
            return cb(null);
        client.getObject(bucketName, "I|objNameToRowID", log, (err, data) => {
            if (err)
                return cb(err);
            data = JSON.parse(data);
            let rowId = 0;
            if (Object.keys(data)) {
                if (typeof data[objName] === "number")
                    rowId = data[objName];
                else
                    rowId = Object.keys(data).length/2+1;
            }
            data[rowId] = objName;
            data[objName] = rowId;
            client.putObject(bucketName, "I|objNameToRowID", JSON.stringify(data), log, err => {
                if (err)
                    return cb(err);
                const tags = [];
                return updateIndex(bucketName, objName, objVal, rowId, Object.keys(data).length/2, log, cb);
            });
        });
    }

};

export default index;

function updateIndex(bucketName, objName, objVal, rowId, objCounter, log, cb) {
    const tags = [];
    Object.keys(objVal).forEach(elem => {
        if (elem.indexOf("x-amz-meta") != -1 && elem != "x-amz-meta-s3cmd-attrs")
            tags.push(elem+"/"+objVal[elem]);
    });
    client.getObject(bucketName, "I|TagIndex", log, (err, data) => {
        if (err) {
            return cb(err);
        }
        data = JSON.parse(data);
        tags.forEach(tag => {
            if (tag.indexOf("--integer") !== -1) {
                tag = tag.replace("--integer", "");
                data = updateIntegerIndex(tag, rowId, objCounter, data);
            }
            else
                data[tag] = updateBitmap(storeToBitmap(data[tag]), rowId, objCounter);
        });
        if (rowId > data.counter)
            data.counter = rowId;
        client.putObject(bucketName, "I|TagIndex", JSON.stringify(data), log, err => {
            if (err) {
                return cb(err);
            }
            return cb(err);
        });
    });
}

function getObjects(params, searchTerm, callback) {
    if (searchTerm .indexOf("op/AND") !==-1 || searchTerm.indexOf("op/OR") !==-1)
        return callback(null, searchTerm);
    const { bucketName, log, cb } = params;
    let term = null;
    let operator = null;
    let notOperator = false;
    if (searchTerm.indexOf("op/NOT") !== -1) {
        searchTerm = searchTerm.split("&")[1];
        notOperator = true;
    }
    if (searchTerm.indexOf("--integer") !== -1) {
        term = searchTerm.split("/")[0]+"/"+searchTerm.split("/")[2];
        operator = searchTerm.split("/")[1];
    }
    else
        term = searchTerm;
    client.getObject(bucketName, "I|TagIndex", log, (err, data) => {
        if (err)
            return cb(err);
        data = JSON.parse(data);
        let result = null;
        if (operator)
            result = evaulateIntegerRange(operator, term, data);
        else
            result = storeToBitmap(data[term]);
        if (notOperator) {
            result.push(data.counter+1);
            result = result.not();
        }
        callback(null, result);
    });
}

function evaulateIntegerRange(operator, term, data) {
    term = term.replace("--integer", "");
    const attr = term.split("/")[0];
    const value = parseInt(term.split("/")[1]);
    if (operator === "=") {
        const nextValue = term.split("/")[0]+"/"+data[attr][data[attr].indexOf(value)+1];
        if (!data.hasOwnProperty(term)) {
            return bitmap.createObject();
        }
        else if (!data.hasOwnProperty(nextValue)) {
            return storeToBitmap(data[term]);
        }
        else {
            return storeToBitmap(data[term]).xor(storeToBitmap(data[nextValue]));
        }
    }
    else if (operator === "<") {
        const lowestValue = term.split("/")[0]+"/"+data[attr][0];
        if (parseInt(term.split("/")[1]) > data[attr][data[attr].length-1])
            return storeToBitmap(data[lowestValue]);
        else
            return storeToBitmap(data[term]).xor(storeToBitmap(data[lowestValue]));
    }
    else if (operator === "<=") {
        const nextValue = term.split("/")[0]+"/"+data[attr][data[attr].indexOf(value)+1];
        const lowestValue = term.split("/")[0]+"/"+data[attr][0];
        if (parseInt(term.split("/")[1]) >= data[attr][data[attr].length-1])
            return storeToBitmap(data[lowestValue]);
        else
            return storeToBitmap(data[lowestValue]).xor(storeToBitmap(data[nextValue]));
    }
    else if (operator === ">") {
        const nextValue = term.split("/")[0]+"/"+data[attr][data[attr].indexOf(value)+1];
        const lowestValue = term.split("/")[0]+"/"+data[attr][0];
        if (parseInt(term.split("/")[1]) < data[attr][0])
            return storeToBitmap(data[lowestValue]);
        else
            return storeToBitmap(data[term]).and(storeToBitmap(data[nextValue]));
    }
    else if (operator === ">=") {
        const previousValue = term.split("/")[0]+"/"+data[attr][data[attr].indexOf(value)-1];
        const lowestValue = term.split("/")[0]+"/"+data[attr][0];
        if (parseInt(term.split("/")[1]) <= data[attr][0])
            return storeToBitmap(data[lowestValue]);
        else
            return storeToBitmap(data[term]).and(storeToBitmap(data[previousValue]));
    }
}

function constructResponse(result, bucketName, log, cb, params) {
    const { prefix, marker, delimiter, maxKeys } = params;
    result = result.toString(":").split(":");
    client.getObject(bucketName, "I|objNameToRowID", log, (err, data) => {
        if (err)
            return cb(err);
        data = JSON.parse(data);
        result = result.map(function(elem){
            return data[elem];
        });
        client.listObject(bucketName, { prefix:"", marker, maxKeys, delimiter },
            log, (err, data) => {
                if (err)
                    return cb(err);
                data.Contents = data.Contents.filter(function(elem) {
                    return result.indexOf(elem.key) !== -1;
                });
                return cb(err, data);
            });
    });
}

function updateIntegerIndex(tag, rowId, objCounter, indexData) {
    const tagAttr = tag.split("/")[0];
    const tagValue = parseInt(tag.split("/")[1]);
    if (!indexData.hasOwnProperty(tagAttr))
        indexData[tagAttr] = [];
    if (indexData[tagAttr].indexOf(tagValue) === -1)
        indexData[tagAttr].push(tagValue);
    indexData[tagAttr].sort();
    const ind = indexData[tagAttr].indexOf(tagValue);
    let index = {};
    if (!indexData.hasOwnProperty(tagAttr+"/"+indexData[tagAttr][ind+1]))
        indexData[tag] = updateBitmap(storeToBitmap(indexData[tag]), rowId, objCounter);
    else
        indexData[tag] = updateBitmap(storeToBitmap(indexData[tagAttr+"/"+indexData[tagAttr][ind+1]]), rowId, objCounter);
    for (var i=ind-1; i>=0; i--) {
        index = storeToBitmap(indexData[tagAttr+"/"+indexData[tagAttr][i]]);
        index.push(rowId);
        indexData[tagAttr+"/"+indexData[tagAttr][i]] = bitmapToStore(index);
    }
    return indexData;
}

function updateBitmap(bitmap, rowId, objCounter) {
    if (rowId === objCounter)
        bitmap.push(rowId);
    else
        bitmap = bitmap.copyandset(rowId);
    return bitmapToStore(bitmap);
}

function storeToBitmap(stored) {
    const bm = bitmap.createObject();
    if (stored) {
        stored[2] = new Buffer(stored[2], "binary");
        bm.read(stored);
    }
    return bm;
}

function bitmapToStore(bitmap) {
    let toStore = bitmap.write();
    toStore[2] = toStore[2].toString("binary");
    return toStore;
}