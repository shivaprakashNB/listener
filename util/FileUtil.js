var path = require('path');
var shortId = require('shortid');
module.exports = {
    getExtension: function(fileName) {
        if (!fileName) {
            return undefined;
        }
        var a = fileName.split(".");
        if (a.length === 1 || (a[0] === "" && a.length === 2)) {
            return undefined;
        }
        return a.pop().toLowerCase();
    },
    removeExtension: function(fileName) {
        if (!fileName) {
            return undefined;
        }
        return fileName.split(".")[0];
    },
    getFileName: function(fileFullName) {
        if (!fileFullName) {
            return undefined;
        }

        var fileName = fileFullName.replace(/^.*[\\\/]/, '');
        return fileName;
    },

    getFileType: function(fileName) {
        if (!fileName) {
            return "other";
        }

        var ext = this.getExtension(fileName);
        if (_.contains(sails.config.fileFormats.video, ext)) {
            return "video";
        } else {
            return "other";
        }
    },
    saveUserFile: function(req, maxBytes, next) {
        var dirname = '';
        if (req.param('dirname'))
            dirname = req.param('dirname');
        req.file('file').upload({
            saveAs: function(__newFileStream, next) {
                var origFileName = __newFileStream.filename;
                var fileName = makeFileName(req, origFileName);
                console.log('Saving as ' + fileName);
                next(null, fileName);
            },
            dirname: dirname,
            maxBytes: maxBytes,
            adapter: require('skipper-s3'),
            key: sails.config.s3.key,
            secret: sails.config.s3.secret,
            bucket: sails.config.s3.bucketName
        }, function(err, updFiles) {
            if (err) {
                console.log(err);
                return next(err);
            }
            
            if (!updFiles || updFiles.length === 0) {
                return next('A file must be uploaded.');
            }
            console.log("updFiles[0].fd:",updFiles[0].fd);
            AWSService.addMeta(updFiles[0].fd);
            AWSService.getJson(updFiles[0], function(err, resJson){
                if(err){
                    console.log(err);
                    next(err, null, null); 
                }else{
                    // console.log(resJson)
                    next(null, updFiles[0], resJson);
                }
            })
        });
    },
    uploadImgs: function(req, maxBytes, next) {
        var dirname = '';
        if (req.param('dirname'))
            dirname = req.param('dirname');
        console.log("dirname:",dirname);
        req.file('file').upload({
            saveAs: function(__newFileStream, next) {
                var origFileName = __newFileStream.filename;
                var fileName = makeFileName(req, origFileName);
                console.log('Saving as ' + fileName);
                next(null, fileName);
            },
            dirname: dirname,
            maxBytes: maxBytes,
            adapter: require('skipper-s3'),
            key: sails.config.s3.key,
            secret: sails.config.s3.secret,
            bucket: sails.config.s3.bucketName
        }, function(err, updFiles) {
            if (err) {
                console.log(err);
                return next(err);
            }
            //This is removed because of non mandatory files.
            // if (updFiles && updFiles.length === 0) {
            //     return next('A file must be uploaded.');
            // }
            var filesData=[];
            updFiles.map(function(obj){
                AWSService.addMeta(obj.fd);
                filesData.push(obj.extra.Location);
            })
            next(null, filesData);
        });
    }

};

function makeFileName(req, inputFileName) {
    var ext = path.extname(inputFileName)
    console.log("companyID:",req.headers.companyid)
    var fileKey = req.headers.companyid + "_" + shortId.generate(); //req.authInfo.id;
    return fileKey + ext.toLowerCase();
}
