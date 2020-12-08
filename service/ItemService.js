var shortId = require('shortid');
var pUtil = require('../util/PageUtil');
var moment = require('moment');
var request = require('request');
var sqs = require('sqs');
// var queue = sqs({
//     access: sails.config.sqs.key,
//     secret: sails.config.sqs.secret,
//     region: sails.config.sqs.region
// });
module.exports = {
    init: function() {
      var a = "[AJAX,869170030098819,ARGO4000,20201202124307,32,1,29.429100,29.429100,76.206315,76.206315,0.00,23,1,1,12001,3732,6186,6186,5910,1422,0,0,10716,10734,10686,0,0,0,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,C03.01.40A,I13,1144]"
        console.log('Initiating Heartbeat listener on queue ', a);
        queue.pull(sails.config.mynavi.listenerQueue, function(message, next) {
            
            var dataArr = message.split(',');
            // console.log("message length :"+dataArr.length);
            if(dataArr.length == 39 || dataArr.length == 22){
                if(dataArr[0].replace(/\[|\]/g,'') == 'AJAX'){
                    enrichItem(message, function(err, retItems) {})
                    next();
                }
                if(dataArr[0].replace(/\[/g,'') == 'AJAX-1'){
                    enrichBatch(message, function(err, retItems) {})
                    next();
                }
                if(dataArr[0].replace(/\[|\]/g,'') == 'AJAX-2'){
                    enrichConsumption(message, function(err, retItems) {})
                    next();
                }
                
            }else{
                sails.log.info('Invalid data received for the device ', message);
                return next(null, {
            'status': 'success'});
            }
            
        });
    }
}


function enrichItem(message, next) {
    var dataArray = message.split(',');
    if (dataArray.length == 39) {
        sails.log.info('Invalid data received for the device ', message);
        return next("Invalid data format")
    }
    var companyID = 'AJAXFIORI';
    var deviceID = dataArray[0];
    if (!(dataArray[7] && dataArray[7].length >= 14)) {
        return next("Invalid date format")
    }
    var dateString = dataArray[7].substring(0, 14);
    var timeZone = parseTimeZone(dataArray[6]);
    // Device timestamp is always in UTC
    var convertedDate = moment(dateString + "UTC", "YYYYMMDDHHmmssZ");
    var obj = {
        "companyID": companyID,
        "deviceID": deviceID,
        "devicePublishTime": new Date(convertedDate),
        "timeZone": timeZone,
        "rawData": message,
        "lat": dataArray[8],
        "lng": dataArray[10]
    };
    /*if (dataArray[8] !== '' && dataArray[10] !== '') {
        obj.active = 'true';
    }*/
    var dvquery = {};
    dvquery.companyID = 'AJAXFIORI';
    dvquery.deviceID = deviceID;
    dvquery.type = 'dvmap';
    Item.findOne(dvquery, function(err, retDvmap) {
        if (err) {
            return next(err)
        };
        var vehicleNumber = null;
        if (retDvmap) {
            obj.vehicleNumber = retDvmap.vehicleNumber;
        }
        // In prepare
        var newObj = {};
        enrichParams(obj, dataArray, function(err, newObj) {
            processItems(newObj, function(err, response) {
                if (err) {
                    return next(err);
                };
                return next(response);
            })
        })
        return;
    })
}

function enrichParams(obj, dataStr, next) {
    var newObj = {};
    newObj.afcStatus = dataStr[12].trim();
    newObj.opsStatus = dataStr[13].trim();
    newObj.batteryLevel = dataStr[14].trim();
    newObj.sendVehiclePosition = dataStr[15].trim();
    newObj.fuelLevel = dataStr[16].trim();
    newObj.rpm = dataStr[17].trim();
    newObj.mvgStatus = dataStr[18].trim();
    newObj.wsw1 = dataStr[19].trim();
    newObj.wsw2 = dataStr[20].trim();
    newObj.wsw3 = dataStr[21].trim();
    newObj.wsw4 = dataStr[22].trim();
    newObj.travelSpeed = dataStr[23].trim();
    newObj.throttlePosition = dataStr[24].trim();
    newObj.coolantTemp = dataStr[25].trim();
    newObj.transOilTemp = dataStr[26].trim();
    newObj.gbOilTemp = dataStr[27].trim();
    newObj.engineOilTemp = dataStr[28].trim();
    newObj.ambientTemp = dataStr[29].trim();
    newObj.saoStatus = dataStr[30].trim();
    obj.extras = newObj;
    prepareTranslations(obj, function(err, retHeartbeat) {
        if (retHeartbeat) {
            obj.translations = retHeartbeat.translations;
            return next(null, obj);
        } else {
            return next(null, obj);
        }
    });
}

function processItems(heartbeat, next) {
    createItem(heartbeat, function(err, retResp) {
        if (err) {
            return next(err);
        };
        if (retResp) {
            var timestamp = retResp.createdAt;
            //markPreviousItemAsInactive
            /* if (heartbeat.active === 'true') {
                 markPreviousItemAsInactive(retResp.createdAt, heartbeat)
                 delete retResp.createdAt;
             }*/
            // Update last data received timestmap
            updateLastDataReceived(heartbeat.deviceID, heartbeat.lat, heartbeat.lng);
            //checkMinMax and Send notification
            checkAndAlert(heartbeat);
            //Do engineHours calculation and update
            doEngineHoursCreateAndUpdate(heartbeat.extras.rpm, heartbeat.deviceID, heartbeat.vehicleNumber, timestamp);
            return next(retResp);
        };
    });
}

function prepareTranslations(heartbeats, next) {
    Mappings.find({}, function(err, retMappings) {
        if (err) {
            console.log(err);
            return next({
                'status': 'Failed to query DB'
            });
        };
        if (retMappings.length > 0) {
            try {
                var extras = heartbeats.extras;
                var translation = [];
                if (extras) {
                    var afcStatus = parseInt(extras.afcStatus);
                    var opsStatus = parseInt(extras.opsStatus);
                    var mvgStatus = parseInt(extras.mvgStatus);
                    var batteryLevel = parseInt(extras.batteryLevel);
                    var coolantTemp = parseInt(extras.coolantTemp);
                    var fuelLevel = parseInt(extras.fuelLevel);
                    var rpm = parseInt(extras.rpm);
                    var afcStatusValue = _.findWhere(_.findWhere(retMappings, {
                        type: 'afcStatus'
                    }).mappings, {
                        value: afcStatus
                    });
                    var opsStatusValue = _.findWhere(_.findWhere(retMappings, {
                        type: 'opsStatus'
                    }).mappings, {
                        value: opsStatus
                    });
                    var mvgStatusValue = _.findWhere(_.findWhere(retMappings, {
                        type: 'mvgStatus'
                    }).mappings, {
                        value: mvgStatus
                    });
                    var batteryLevelValue = _.findWhere(retMappings, {
                        type: 'batteryLevel'
                    });
                    var minBatteryLevel = _.min(batteryLevelValue.values);
                    var maxBatteryLevel = _.max(batteryLevelValue.values);
                    var blDisplayValue = null;
                    if (minBatteryLevel)
                        if (batteryLevel < minBatteryLevel) {
                            blDisplayValue = batteryLevelValue.minDisplayValue;
                        };
                    if (maxBatteryLevel)
                        if (batteryLevel > maxBatteryLevel) {
                            blDisplayValue = batteryLevelValue.maxDisplayValue;
                        };
                    if (batteryLevel >= minBatteryLevel && batteryLevel <= maxBatteryLevel) {
                        blDisplayValue = batteryLevelValue.normalDisplayValue;
                    };
                    //=====================================================================
                    var rpmLevelValue = _.findWhere(retMappings, {
                        type: 'rpm'
                    });
                    var minRpmLevel = _.min(rpmLevelValue.values);
                    var maxRpmLevel = _.max(rpmLevelValue.values);
                    var rpmDisplayValue = null;
                    if (rpm == minRpmLevel) {
                        rpmDisplayValue = rpmLevelValue.minDisplayValue;
                    };
                    if (maxRpmLevel)
                        if (rpm >= maxRpmLevel) {
                            rpmDisplayValue = rpmLevelValue.maxDisplayValue;
                        };
                    if (rpm > minRpmLevel && rpm <= maxRpmLevel) {
                        rpmDisplayValue = rpmLevelValue.normalDisplayValue;
                    };
                    //====================================================================
                    var coolantTempValue = _.findWhere(retMappings, {
                        type: 'coolantTemp'
                    });
                    var minCoolantTempLevel = _.min(coolantTempValue.values);
                    var maxCoolantTempLevel = _.max(coolantTempValue.values);
                    var coolantTempDisplayValue = null;

                    if (coolantTemp < minCoolantTempLevel) {
                        coolantTempDisplayValue = coolantTempValue.minDisplayValue;
                    };
                    if (maxCoolantTempLevel)
                        if (coolantTemp > maxCoolantTempLevel) {
                            coolantTempDisplayValue = coolantTempValue.maxDisplayValue;
                        };
                    if (coolantTemp >= minCoolantTempLevel && coolantTemp <= maxCoolantTempLevel) {
                        coolantTempDisplayValue = coolantTempValue.normalDisplayValue;
                    };
                    //======================================================================
                    var fuelLevelValue = _.findWhere(retMappings, {
                        type: 'fuelLevel'
                    });
                    var minFuelLevel = _.min(fuelLevelValue.values);
                    var maxFuelLevel = _.max(fuelLevelValue.values);
                    var fuelLevelDisplayValue = null;
                    if (fuelLevel == minFuelLevel) {
                        fuelLevelDisplayValue = fuelLevelValue.minDisplayValue;
                    };
                    if (fuelLevel == maxFuelLevel) {
                        fuelLevelDisplayValue = fuelLevelValue.maxDisplayValue;
                    };
                    //======================================================================
                    if (afcStatusValue) {
                        var obj = {};
                        obj.value = afcStatus;
                        obj.label = _.findWhere(retMappings, {
                            type: 'afcStatus'
                        }).label;
                        obj.status = afcStatusValue.displayValue;
                        obj.order = _.findWhere(retMappings, {
                            type: 'afcStatus'
                        }).order;
                        translation.push(obj);
                    } else {
                        var obj = {};
                        obj.value = afcStatus;
                        obj.label = _.findWhere(retMappings, {
                            type: 'afcStatus'
                        }).label;
                        obj.status = "Not a valid state";
                        obj.order = _.findWhere(retMappings, {
                            type: 'afcStatus'
                        }).order;
                        translation.push(obj);
                    }
                    if (opsStatusValue) {
                        var obj = {};
                        obj.value = opsStatus;
                        obj.label = _.findWhere(retMappings, {
                            type: 'opsStatus'
                        }).label;
                        obj.status = opsStatusValue.displayValue;
                        obj.order = _.findWhere(retMappings, {
                            type: 'opsStatus'
                        }).order;
                        translation.push(obj);
                    } else {
                        var obj = {};
                        obj.value = opsStatus;
                        obj.label = _.findWhere(retMappings, {
                            type: 'opsStatus'
                        }).label;
                        obj.status = "Not a valid state";
                        obj.order = _.findWhere(retMappings, {
                            type: 'opsStatus'
                        }).order;
                        translation.push(obj);
                    }
                    if (mvgStatusValue) {
                        var obj = {};
                        obj.value = mvgStatus;
                        obj.label = _.findWhere(retMappings, {
                            type: 'mvgStatus'
                        }).label;
                        obj.status = mvgStatusValue.displayValue;
                        obj.order = _.findWhere(retMappings, {
                            type: 'mvgStatus'
                        }).order;
                        translation.push(obj);
                    } else {
                        var obj = {};
                        obj.value = mvgStatus;
                        obj.label = _.findWhere(retMappings, {
                            type: 'mvgStatus'
                        }).label;
                        obj.status = "Not a valid state";
                        obj.order = _.findWhere(retMappings, {
                            type: 'mvgStatus'
                        }).order;
                        translation.push(obj);
                    }
                    if (blDisplayValue) {
                        var obj = {};
                        obj.value = batteryLevel;
                        obj.label = batteryLevelValue.label;
                        obj.status = blDisplayValue;
                        obj.order = batteryLevelValue.order;
                        translation.push(obj);
                    } else {
                        var obj = {};
                        obj.value = batteryLevel;
                        obj.label = batteryLevelValue.label;
                        obj.status = "Not a valid state";
                        obj.order = batteryLevelValue.order;
                        translation.push(obj);
                    }
                    if (rpmDisplayValue) {
                        var obj = {};
                        obj.value = rpm;
                        obj.label = rpmLevelValue.label;
                        obj.status = rpmDisplayValue;
                        obj.order = rpmLevelValue.order;
                        translation.push(obj);
                    } else {
                        var obj = {};
                        obj.value = rpm;
                        obj.label = rpmLevelValue.label;
                        obj.status = "Not a valid state";
                        obj.order = rpmLevelValue.order;
                        translation.push(obj);
                    }
                    if (coolantTempDisplayValue) {
                        var obj = {};
                        obj.value = coolantTemp;
                        obj.label = coolantTempValue.label;
                        obj.status = coolantTempDisplayValue;
                        obj.order = coolantTempValue.order;
                        translation.push(obj);
                    } else {
                        var obj = {};
                        obj.value = coolantTemp;
                        obj.label = coolantTempValue.label;
                        obj.status = "Not a valid state";
                        obj.order = coolantTempValue.order;
                        translation.push(obj);
                    }
                    if (fuelLevelDisplayValue) {
                        var obj = {};
                        obj.value = fuelLevel;
                        obj.label = fuelLevelValue.label;
                        obj.status = fuelLevelDisplayValue;
                        obj.order = fuelLevelValue.order;
                        translation.push(obj);
                    } else {
                        var obj = {};
                        obj.value = fuelLevel;
                        obj.label = fuelLevelValue.label;
                        obj.status = fuelLevel + "%";
                        obj.order = fuelLevelValue.order;
                        translation.push(obj);
                    }
                    heartbeats.translations = translation;
                    return next(null, heartbeats);
                }
            } catch (ex) {
                console.log(ex);
                return next({
                    'status': 'invalid mappings'
                });
            }
        } else {
            return next(null, heartbeats);
        }
    });
}

function updateDVMAPItem(obj) {
    var query = {};
    query.deviceID = obj.deviceID;
    query.type = 'dvmap';
    Item.update(query, obj, function(err, retItem) {
        if (err) {
            console.log('dvmap item update failed');
        };
    });
}

function doEngineHoursCreateAndUpdate(rpm, deviceID, vehicleNumber, timestamp) {
    var rpm = parseInt(rpm);
    if (rpm <= 0) {
        checkIsEngineClosed(deviceID, vehicleNumber, function(err, retObj) {
            if (err) {
                console.log(err);
            };
            if (retObj && !retObj.closed) {
                var enginehours = {};
                enginehours.closed = true;
                enginehours.deviceID = deviceID;
                enginehours.offTimestamp = timestamp;
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
                            updateDVMAPItem(itemObj);
                        })
                    }
                });
            } else {
                //console.log('::::::::::do nothing');
            }
        });
    } else {
        checkIsEngineClosed(deviceID, vehicleNumber, function(err, retObj) {
            if (err) {
                console.log(err);
            };
            if (!retObj || retObj.closed) {
                var enginehours = {};
                enginehours.companyID = 'AJAXFIORI';
                enginehours.deviceID = deviceID;
                enginehours.closed = false;
                enginehours.onTimestamp = timestamp;
                enginehours.vehicleNumber = vehicleNumber;
                createEngineHours(enginehours);
            } else {
                // console.log('::::::::::do nothing')
            }
        });
    }
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

function createEngineHours(engineHours) {
    Enginehours.create(engineHours, function(err, retObj) {
        if (err) {
            console.log(err);
        };
        if (retObj) {
            //console.log('::::::::::::::::::::engineHours created');
            var obj = {};
            obj.deviceID = engineHours.deviceID;
            obj.engineLastOn = engineHours.onTimestamp;
            obj.engineOn = true;
            updateDVMAPItem(obj);
        };
    })
}

function updateEngineHours(enginehours) {
    var query = {};
    query.deviceID = enginehours.deviceID;
    if (enginehours.vehicleNumber) {
        query.vehicleNumber = enginehours.vehicleNumber;
    };
    query.closed = false;
    Enginehours.update(query, enginehours, function(err, retObj) {
        if (err) {
            console.log(err);
        };
        if (retObj.length > 0) {
            //console.log('::::::::::::::::::::engineHours updated');
        };
    })
}

function checkIsEngineClosed(deviceID, vehicleNumber, next) {
    var query = {};
    query.deviceID = deviceID;
    if (vehicleNumber) {
        query.vehicleNumber = vehicleNumber;
    };
    query.closed = false;
    Enginehours.findOne(query, function(err, retObj) {
        if (err) {
            console.log(err);
        };
        return next(null, retObj);
    });
}

function markPreviousItemAsInactive(latestDate, heartbeat) {
    var query = {};
    query.companyID = heartbeat.companyID;
    query.deviceID = heartbeat.deviceID;
    query.active = 'true';
    query.createdAt = {
        '<': latestDate
    }
    var update = {
        active: "false"
    };
    Heartbeat.update(query, update, function(err, retItems) {
        if (err) {
            console.log('Error in markPreviousItemAsInactive: ', err);
        };
    });
}

function checkAndAlert(activeHeartbeat) {
    var params = activeHeartbeat.extras;
    var query = {
        "companyID": activeHeartbeat.companyID,
        "type": "SETTINGS"
    }
    var query = {};
    query.companyID = activeHeartbeat.companyID;
    query.type = 'dvmap';
    query.deviceID = activeHeartbeat.deviceID;

    Item.findOne(query, function(err, retDvmap) {
        if (retDvmap) {
            _.each(params, function(val, key) {
                var text = getSMSTextByParam(key, val, retDvmap, activeHeartbeat, function(text) {
                    if (text != null) {
                        if (canSendAlert(key, retDvmap)) {
                            sendNotification(text, retDvmap, function(err) {
                                if (err) {
                                    console.log('Error sending notification', err);
                                    return;
                                }
                                updateAlertSentStatus(key, retDvmap, true);
                                updateShowInSummary(activeHeartbeat);
                            });
                        }
                    } else {
                        updateAlertSentStatus(key, retDvmap, false);
                    }
                });
            })
        }
    })
}

function updateAlertSentStatus(param, dvmap, alertStatus) {
    var dvmapUpdate = {};
    dvmapUpdate.deviceID = dvmap.deviceID;
    if (!dvmap.alerts) {
        dvmapUpdate.alerts = {};
    } else {
        dvmapUpdate.alerts = dvmap.alerts;
    }
    dvmapUpdate.alerts[param] = alertStatus;
    updateDVMAPItem(dvmapUpdate);
}

function updateShowInSummary(heartbeat) {
    /*var query = {};
    query.deviceID = deviceID;
    query.active = 'true';
    Heartbeat.update(query, {
        alert: "true"
    }, function(err, retHeartbeat) {
        if (err) {
            console.log("Error updating alert flag on heartbeat")
        };
    });*/
    heartbeat.alert = "true";
    heartbeat.hID = heartbeat.id;
    delete heartbeat.id;
    Alert.create(heartbeat).exec(function(err, retAlert) {
        if (err) {
            console.log(err);
        };
        if (retAlert) {
            //console.log('alert created...');
        };
    })
}

function validateMinMax(val, min, max) {
    val = parseInt(val);
    min = parseInt(min);
    max = parseInt(max);
    if (val >= min && val <= max)
        return true;
    return false
}

function createItem(newObj, next) {
    Heartbeat.create(newObj).exec(function(err, item) {
        if (err) {
            console.log('Error..........', err)
            return next({
                "status": "Failed to query DB"
            })
        };
        if (!item) {
            next({
                "status": "No data found"
            });
            return;
        };
        next(null, {
            'status': 'success',
            'createdAt': item.createdAt
        });
    });
}

function updateLastDataReceived(deviceID, lat, lng) {
    var lastDataReceivedAt = new Date();
    getLocationByLatLng(lat + "," + lng, function(location) {
        var updateObj = {};
        updateObj.deviceID = deviceID;
        updateObj.lastDataReceivedAt = lastDataReceivedAt;
        if (location != null) {
            updateObj.vehicleLocation = location;
        }
        updateObj.lat = lat;
        updateObj.lng = lng;
        updateDVMAPItem(updateObj);
    });
}

function getSMSTextByParam(param, value, dvmap, heartbeat, next) {
    if (dvmap.vehicleNumber) {
        if (param === 'afcStatus') {
            if (value == '1')
                return next("Air Filter Choke for vehicle Number " + dvmap.vehicleNumber + " was activated at " + getHHMM(heartbeat.dateTime, heartbeat.timeZone));
            else
                return next(null);
        }
        if (param === 'opsStatus') {
            if (value == '1')
                return next("Oil pressure switch for vehicle Number " + dvmap.vehicleNumber + " was activated at " + getHHMM(heartbeat.dateTime, heartbeat.timeZone));
            else
                return next(null);
        }
        if (param === 'mvgStatus') {
            if (value == '1')
                return next("Moving Vehicle Gear switch for vehicle Number " + dvmap.vehicleNumber + " was activated at " + getHHMM(heartbeat.dateTime, heartbeat.timeZone));
            else
                return next(null);
        }
        if (param === 'batteryLevel') {
            if ((value > 0 && value < 8) || value > 18)
                return next("Battery voltage for vehicle number " + dvmap.vehicleNumber + " has crossed its min-max limit. Current value: " + value + "V");
            else
                return next(null);
        }
        if (param === 'fuelLevel') {
            if (value >= 5 && value <= 22)
                return next("Fuel level for vehicle number " + dvmap.vehicleNumber + " is in reserved");
            else
                return next(null);
            if (value >= 94 && value <= 100)
                return next("Fuel level for vehicle number " + dvmap.vehicleNumber + " is full");
            else
                return next(null);
        }
        if (param === 'rpm') {
            if (value > 5000)
                return next("RPM for vehicle number " + dvmap.vehicleNumber + " has crossed max. limit. Current value of RPM: " + value);
            else
                return next(null);
        }
        if (param === 'coolantTemp') {
            if (value > 112)
                return next("Coolant temperature for vehicle Number " + dvmap.vehicleNumber + " has crossed its max limit. Current value: " + value + "C.");
            else
                return next(null);
        }
        if (param === 'sendVehiclePosition') {
            if (value == '1') {
                var latlng = heartbeat.lat + "," + heartbeat.lng;
                getLocationByLatLng(latlng, function(location) {
                    if (location) {
                        return next("The last location of vehicle number " + dvmap.vehicleNumber + ": " + location);
                    } else {
                        return next(null);
                    }
                })
            } else {
                return next(null);
            }
        }
        //return next(null);
    } else {
        return next(null);
    }
}

function getHHMM(dateTime, timeZone) {
    try {
        return moment(dateTime).utcOffset(timeZone).format('HH:mm');
    } catch (e) {
        console.log(e);
    }
    return "";
}

function parseTimeZone(tz) {
    if (tz == '') {
        return "UTC";
    }
    tzNumber = tz.replace(/[\+]/, "").replace(/[\:]+/, "");
    if (isNaN(tzNumber)) {
        return tz;
    }
    return "+0" + tz.replace(/^[\+]+/, "").replace(/^[0]+/, "");
}

function canSendAlert(param, dvmap) {
    if (dvmap.alerts === undefined) {
        return true;
    } else {
        var alertStatus = dvmap.alerts[param];
        if (alertStatus === undefined || alertStatus === false) {
            return true;
        } else {
            return false;
        }
    }
}

function sendNotification(text, items, next) {
    var notifObj = {};
    notifObj.companyID = 'AJAXFIORI';
    // var customerList = _.pluck(items, 'customerID');
    // console.log(customerList);
    // customerList = customerList.concat();
    notifObj.userID = items.customerID;
    notifObj.mobileNumber = items.alertMobile;
    //console.log('notifObj.userID', notifObj.userID)
    notifObj.content = text;
    notifObj.deliveryMethod = ['SMS', 'EMAIL'];
    notifObj.appName = 'AUTH';
    notifObj.title = 'Ajaxfiori Vehicle status';
    NotificationService.send(notifObj, function(err, retResp) {
        if (err) {
            return next(err);
        };
        if (retResp) {
            return next(null, retResp);
        };
    });
}

function getLocationByLatLng(latlng, next) {
    var options = {
        url: "http://maps.googleapis.com/maps/api/geocode/json?latlng=" + latlng + "&sensor=true",
        method: 'GET'
    };
    request(options, function(error, response, body) {
        if (!error && response.statusCode === 200) {
            var location;
            try {
                apiResp = JSON.parse(body);
                location = apiResp.results[0].formatted_address;
                return next(location);
            } catch (ex) {
                return next(null);
            }
        } else {
            return next(null);
        }
    });
}

function enrichBatch(message, next){
    var dataArray = message.replace(/\[|\]/g,'').split(",");

    if (dataArray.length != 22) {
        sails.log.info('Invalid data received for the device ', message);
        return next("Invalid data format")
    }
    var companyID = 'AJAXFIORI';
    var deviceID = dataArray[1];
    if (!(dataArray[3] && dataArray[3].length >= 14)) {
        return next("Invalid date format")
    }
    var DT = dataArray[7].trim().split('-');
    var bDT = new Date(DT[1]+'/'+DT[0]+'/'+DT[2]);

    var dateString = dataArray[3].substring(0, 14);
    // var timeZone = parseTimeZone(dataArray[6]);
    // Device timestamp is always in IST
    var convertedDate = moment(dateString + "IST", "YYYYMMDDHHmmssZ");
    

    var newObj = {};

    newObj.companyID= companyID;
    newObj.customerID= dataArray[0];
    newObj.productID= dataArray[2];
    newObj.deviceID= deviceID;
    newObj.devicePublishTime= new Date(convertedDate);
    // "timeZone": timeZone,
    newObj.rawData = message;
    newObj.batchNo = dataArray[4].trim();
    newObj.machineID = dataArray[5].trim();
    newObj.batchTime = dataArray[6].trim();
    newObj.batchDate = bDT;
    newObj.aggt10mm = parseFloat(dataArray[8].trim());
    newObj.aggt20mm = parseFloat(dataArray[9].trim());
    newObj.aggt30mm = parseFloat(dataArray[10].trim());
    newObj.cement01mm = parseFloat(dataArray[11].trim());
    newObj.cement02mm = parseFloat(dataArray[12].trim());
    newObj.sand01mm = parseFloat(dataArray[13].trim());
    newObj.sand02mm = parseFloat(dataArray[14].trim());
    newObj.water = parseFloat(dataArray[15].trim());
    newObj.additive = parseFloat(dataArray[16].trim());
    newObj.totalWT = parseFloat(dataArray[17].trim());
    newObj.cum = parseFloat(dataArray[18].trim());
    newObj.fv = dataArray[19].trim();
    newObj.hv = dataArray[20].trim();
    newObj.crc = dataArray[21].trim();
    
    // obj.extras = newObj;
    console.log('Batchreport :');
    console.log(newObj);
    createBranchrepot(newObj, function(err, retHeartbeat) {
        if (retHeartbeat) {
            return next(null, retHeartbeat);
        } else {
            return next(null, err);
        }
    });

}

function enrichConsumption(message, next){
    var dataArray = message.replace(/\[|\]/g,'').split(",");

    if (dataArray.length != 22) {
        sails.log.info('Invalid data received for the device ', message);
        return next("Invalid data format")
    }
    var companyID = 'AJAXFIORI';
    var deviceID = dataArray[1];
    if (!(dataArray[3] && dataArray[3].length >= 14)) {
        return next("Invalid date format")
    }
    var dateString = dataArray[3].substring(0, 14);
    // var timeZone = parseTimeZone(dataArray[6]);
    // Device timestamp is always in IST
    var convertedDate = moment(dateString + "IST", "YYYYMMDDHHmmssZ");
    var DT = dataArray[6].trim().split('-');
    var fromDT = new Date(DT[1]+'/'+DT[0]+'/'+DT[2]);
    var tDT = dataArray[8].trim().split('-');
    var toDT = new Date(tDT[1]+'/'+tDT[0]+'/'+tDT[2]);

    var newObj = {};

    newObj.companyID= companyID;
    newObj.customerID= dataArray[0];
    newObj.productID= dataArray[2];
    newObj.deviceID= deviceID;
    newObj.devicePublishTime= new Date(convertedDate);
    // "timeZone": timeZone,
    newObj.rawData = message;
    newObj.totalWT = parseFloat(dataArray[4].trim());
    newObj.noOfBatches = dataArray[5].trim();
    newObj.fromDate = fromDT;
    newObj.fromTime = dataArray[7].trim();
    newObj.toDate = toDT;
    newObj.toTime = dataArray[9].trim();
    newObj.aggt10mm = parseFloat(dataArray[10].trim());
    newObj.aggt20mm = parseFloat(dataArray[11].trim());
    newObj.aggt30mm = parseFloat(dataArray[12].trim());
    newObj.cement01mm = parseFloat(dataArray[13].trim());
    newObj.cement02mm = parseFloat(dataArray[14].trim());
    newObj.sand01mm = parseFloat(dataArray[15].trim());
    newObj.sand02mm = parseFloat(dataArray[16].trim());
    newObj.water = parseFloat(dataArray[17].trim());
    newObj.additive = parseFloat(dataArray[18].trim());
    newObj.fv = dataArray[19].trim();
    newObj.hv = dataArray[20].trim();
    newObj.crc = dataArray[21].trim();
    
    // obj.extras = newObj;
    console.log('Consumption report :');
    console.log(newObj);
    createConsumptionepot(newObj, function(err, retHeartbeat) {
        if (retHeartbeat) {
            return next(null, retHeartbeat);
        } else {
            return next(null, err);
        }
    });

}

function createBranchrepot(newObj, next) {
    batchreport.create(newObj).exec(function(err, item) {
        if (err) {
            console.log('Error..........', err)
            return next({
                "status": "Failed to query DB"
            })
        };
        if (!item) {
            next({
                "status": "No data found"
            });
            return;
        };
        next(null, {
            'status': 'success'
        });
    });
}

function createConsumptionepot(newObj, next) {
    consumptionreport.create(newObj).exec(function(err, item) {
        if (err) {
            console.log('Error..........', err)
            return next({
                "status": "Failed to query DB"
            })
        };
        if (!item) {
            next({
                "status": "No data found"
            });
            return;
        };
        next(null, {
            'status': 'success'
        });
    });
}