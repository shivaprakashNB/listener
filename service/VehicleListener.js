var scheduler = require('../util/schedule/lib/schedule');

module.exports = {
    init: function() {
        console.log("IdleVehicles background job initialized::::: " + new Date());
        scheduler.scheduleJob("2 * * * * *", findIdleVehclesAndUpdate, {});
        //getNonRespondingVehicles();
        //findIdleVehclesAndUpdate();

    },
}

function findIdleVehclesAndUpdate() {
    var query = {
        "companyID": 'MYNAVI',
        "type": "THRESHOLDTIME"
    };
    Item.findOne(query, function(err, threshold) {
        if (err) {
            return next({ 'status': 'Failed to query DB.' });
        }
        var timegap = 5;
        var thresholdTime
        if (threshold) {
            timegap = threshold.thresholdTime;
            thresholdTime = threshold.thresholdTime * 60;
        };
        var d = new Date();
        var thresholdDate = new Date(d.getTime() - timegap * 60000)
        var dvQuery = {};
        dvQuery.companyID = 'MYNAVI';
        dvQuery.type = 'dvmap';
        dvQuery.updatedAt = {
            '<=': thresholdDate
        }
        Item.find(dvQuery, function(err, retItems) {
            if (err) {
                console.log(err);
            };
            if (retItems) {
                _.each(retItems, function(item) {
                    var retDateAndTime = item.updatedAt;
                    var currentDateAndTime = new Date();
                    var secondsDiff = (currentDateAndTime - retDateAndTime) / 1000;
                    if (secondsDiff > thresholdTime) {
                        doEnginehoursCalculation('MYNAVI', item.deviceID, item.vehicleNumber, retDateAndTime);
                    } else {
                        mQuery.idle = 'false';
                        updateDVMAPItem(mQuery);
                    }
                })
            }
        });
    });
}


function getNonRespondingVehicles() {
    var mQuery = {};
    mQuery.companyID = 'MYNAVI';
    mQuery.type = 'dvmap';
    Item.find(mQuery, function(err, retItem) {
        if (err) {
            console.log(err);
        };
        if (retItem) {
            var query = {
                "companyID": 'MYNAVI',
                "type": "THRESHOLDTIME"
            };
            Item.findOne(query, function(err, threshold) {
                if (err) {
                    return next({ 'status': 'Failed to query DB.' });
                }
                var thresholdTime = 300;
                if (threshold) {
                    thresholdTime = threshold.thresholdTime * 60;
                };
                var deviceIDs = _.pluck(retItem, 'deviceID');
                _.each(deviceIDs, function(deviceID) {
                    var hQuery = {};
                    hQuery.companyID = 'MYNAVI';
                    hQuery.deviceID = deviceID;
                    hQuery.active = 'true';
                    Heartbeat.findOne(hQuery, function(err, retHeartbeat) {
                        if (err) {
                            console.log(err);
                        };
                        mQuery.deviceID = deviceID;
                        if (retHeartbeat) {
                            var retDateAndTime = retHeartbeat.createdAt;
                            var currentDateAndTime = new Date();
                            var secondsDiff = (currentDateAndTime - retDateAndTime) / 1000;
                            if (secondsDiff > thresholdTime) {
                                doEnginehoursCalculation('MYNAVI', deviceID, retHeartbeat.vehicleNumber, retDateAndTime);
                            } else {
                                mQuery.idle = 'false';
                                updateDVMAPItem(mQuery);
                            }
                        }
                        /* else {
                            doEnginehoursCalculation('MYNAVI', deviceID);
                        }*/
                    })
                });
            });
        };
    });
}

function updateDVMAPItem(obj) {
    var query = {};
    query.companyID = obj.companyID;
    query.deviceID = obj.deviceID;
    query.type = 'dvmap';
    Item.update(query, obj, function(err, retItem) {
        if (err) {
            console.log('dvmap item update failed');
        };
    });
}

function doEnginehoursCalculation(companyID, deviceID, vehicleNumber, retDateAndTime) {
    checkIsEngineClosed(deviceID, vehicleNumber, function(err, retObj) {
        if (err) {
            console.log(err);
        };
        if (retObj && !retObj.closed) {
            var enginehours = {};
            enginehours.closed = true;
            enginehours.deviceID = deviceID;
            enginehours.offTimestamp = retDateAndTime;
            getEngineHours(enginehours.offTimestamp, retObj.onTimestamp, function(err, retHours) {
                if (err) {
                    console.log(err);
                };
                if (retHours) {
                    enginehours.engineHours = retHours.hours;
                    enginehours.seconds = retHours.seconds;
                    if (vehicleNumber) {
                        enginehours.vehicleNumber = vehicleNumber;
                    };
                    updateEngineHours(enginehours);
                    var itemObj = {};
                    itemObj.companyID = companyID;
                    itemObj.deviceID = deviceID;
                    itemObj.vehicleNumber = vehicleNumber;
                    itemObj.type = 'dvmap';
                    Item.findOne(itemObj, function(err, retDvmap) {
                        if (err) {};
                        if (retDvmap && retDvmap.totalSeconds) {
                            itemObj.totalSeconds = retDvmap.totalSeconds + enginehours.seconds;
                        } else {
                            itemObj.totalSeconds = enginehours.seconds;
                        }
                        itemObj.totalEngineHours = secondsToHHMMSS(itemObj.totalSeconds);
                        itemObj.engineOn = false;
                        itemObj.idle = 'true';
                        updateDVMAPItem(itemObj);
                    })
                }
            });
        } else {
            //console.log('::::::::::do nothing');
        }
    });

}


function checkIsEngineClosed(deviceID, vehicleNumber, next) {
    var query = {};
    query.deviceID = deviceID;
    query.vehicleNumber = vehicleNumber;
    query.closed = false;
    Enginehours.findOne(query, function(err, retObj) {
        if (err) {
            console.log(err);
        };
        return next(null, retObj);
    });
}

function getEngineHours(offTimestamp, onTimestamp, next) {
    var seconds = (offTimestamp - onTimestamp) / 1000;
    var obj = secondsToHHMMSS(seconds);
    var newObj = {};
    newObj.hours = obj;
    newObj.seconds = seconds;
    return next(null, newObj);
}

function secondsToHHMMSS(totalSeconds) {
    totalSeconds = Math.floor(totalSeconds);
    var hours = Math.floor(totalSeconds / 3600);
    var minutes = Math.floor((totalSeconds - (hours * 3600)) / 60);
    var seconds = totalSeconds - (hours * 3600) - (minutes * 60);
    // round seconds
    seconds = Math.round(seconds * 100) / 100
    var result = (hours < 10 ? "0" + hours : hours);
    result += ":" + (minutes < 10 ? "0" + minutes : minutes);
    result += ":" + (seconds < 10 ? "0" + seconds : seconds);
    return result;
}

function updateEngineHours(enginehours) {
    var query = {};
    query.deviceID = enginehours.deviceID;
    query.vehicleNumber = enginehours.vehicleNumber;
    query.closed = false;
    Enginehours.update(query, enginehours, function(err, retObj) {
        if (err) {
            console.log(err);
        };
        if (retObj.length > 0) {
            //console.log('::::::::::engineHours updated');
        };
    })
}
