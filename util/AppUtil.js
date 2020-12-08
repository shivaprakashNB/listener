 var request = require('request');
 module.exports = {

     var options = {
         url: url,
         headers: headers,
         method: 'GET',
         form: form
     };

     request(options, function(error, response, body) {
         if (!error && response.statusCode === 200) {
             var apiResp;
             try {
                 apiResp = JSON.parse(body);
             } catch (ex) {
                 console.log(body);
                 apiResp = {
                     "status": "Invalid response received from authentication server. Try again after sometime or reach administrator."
                 };
             }
             if (apiResp.status === 'success') {
                 next(null, apiResp);
             } else {
                 next(null, {
                     'status': apiResp.status
                 });
             }
         } else {
             var resp;
             if (error && error.code === 'ETIMEDOUT') {
                 resp = {
                     "status": "Failed to connect to authentication server. Try again after sometime or reach administrator."
                 };
             } else {
                 resp = {
                     "status": 'Failed with unknown error while authenticating your identity. Try again after sometime or reach administrator.'
                 };
             }
             next(resp);
         }
     });
 }