import assert from 'assert';

import bucketDelete from '../../../lib/api/bucketDelete';
import bucketPut from '../../../lib/api/bucketPut';
import constants from '../../../constants';
import metadata from '../metadataswitch';
import objectPut from '../../../lib/api/objectPut';
import DummyRequestLogger from '../helpers';

const log = new DummyRequestLogger();
const accessKey = 'accessKey1';
const namespace = 'default';
const bucketName = 'bucketname';
const postBody = [ new Buffer('I am a body'), ];
const usersBucket = constants.usersBucket;

describe("bucketDelete API", () => {
    afterEach(done => {
        metadata.deleteBucket(bucketName, log, () => {
            metadata.deleteBucket(usersBucket, log, () => {
                done();
            });
        });
    });

    const testBucketPutRequest = {
        bucketName,
        namespace,
        lowerCaseHeaders: {},
        url: `/${bucketName}`,
    };
    const testDeleteRequest = {
        bucketName,
        namespace,
        lowerCaseHeaders: {},
        url: `/${bucketName}`,
    };

    it('should return an error if the bucket is not empty', (done) => {
        const objectName = 'objectName';
        const testPutObjectRequest = {
            bucketName,
            lowerCaseHeaders: {},
            url: `/${bucketName}/${objectName}`,
            namespace,
            post: postBody,
            calculatedMD5: 'vnR+tLdVF79rPPfF+7YvOg==',
            objectKey: objectName,
        };

        bucketPut(accessKey,  testBucketPutRequest, log, () => {
            objectPut(accessKey,  testPutObjectRequest, log, () => {
                bucketDelete(accessKey,  testDeleteRequest, log,
                    err => {
                        assert.strictEqual(err, 'BucketNotEmpty');
                        metadata.getBucket(bucketName, log, (err, md) => {
                            assert.strictEqual(md.name, bucketName);
                            metadata.listObject(usersBucket, accessKey,
                                null, null, null, log, (err, listResponse) => {
                                    assert.strictEqual(listResponse.Contents.
                                        length, 1);
                                    done();
                                });
                        });
                    });
            });
        });
    });

    it('should delete a bucket', (done) => {
        bucketPut(accessKey,  testBucketPutRequest, log, () => {
            bucketDelete(accessKey,  testDeleteRequest, log, () => {
                metadata.getBucket(bucketName, log, (err, md) => {
                    assert.strictEqual(err, 'NoSuchBucket');
                    assert.strictEqual(md, undefined);
                    metadata.listObject(usersBucket, accessKey,
                        null, null, null, log, (err, listResponse) => {
                            assert.strictEqual(listResponse.Contents.length, 0);
                            done();
                        });
                });
            });
        });
    });

    it('should prevent anonymous user from accessing delete bucket API',
        done => {
            bucketDelete('http://acs.amazonaws.com/groups/global/AllUsers',
                 testDeleteRequest, log, err => {
                     assert.strictEqual(err, 'AccessDenied');
                     done();
                 });
        });
});
