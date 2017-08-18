var AWS = require('aws-sdk');
const { execFile } = require('child_process');
const spawnSync = require('child_process').spawnSync;
 

var config = {                                
    accessKeyId: "accessKey1",               
    secretAccessKey: "verySecretKey1",           
    region: "",                       
    endpoint: "localhost:8000",
    sslEnabled: false,
    s3ForcePathStyle: true
};  


AWS.config.update(config);
s3 = new AWS.S3();
//s3.endpoint = new AWS.Endpoint(config.aws.endpoint);


var params = {
Bucket: process.argv[2],
Key: process.argv[3]
};
var file = require('fs').createWriteStream('./image');
s3.getObject(params).createReadStream().pipe(file); 

execFile('python3', ['/home/linuxbrew/models/tutorials/image/imagenet/classify_image.py', '--num_top_predictions', '1', '--image_file', './image'], (error, stdout, stderr) => {
	var tags = stdout.toString().replace("\n", "").split(", ");
	var i = 1;
	var tagSet = [];

	tags.forEach(tag => {
		if (i <= 10) {
			console.log(tag);
			console.log(typeof tag);
			tagSet.push({ Key: "ImageNetTag" + i, Value: "" + tag.toString()});
		}
		i++;
	});

	 var taco_meat = {
                Bucket: process.argv[2],
                Key: process.argv[3],
                Tagging: {
                        TagSet: tagSet
                          }
                       };

	
//	console.log(taco_meat.Tagging.Key);
		s3.putObjectTagging(taco_meat, function(err, data) {
		if (err)
			console.log(err, err.stack);
		else
		console.log("Tag added");
	
		});	
//	console.log(`Key:${key} Value:${tag_list[key]}`);
});
//{
//if (err) console.log(err, err.stack);
//else	console.log(data);
//});
