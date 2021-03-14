"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var http = require('http');
var memjs = require('memjs');
var httpProxy = require('http-proxy');
var mysql = require('mysql');
var NTRIES = 5;
var WTIME = 500;
// Environment variables are defined in app.yaml.
var MEMCACHE_URL = process.env.MEMCACHE_URL || '127.0.0.1:11211';
if (process.env.USE_GAE_MEMCACHE) {
    MEMCACHE_URL = process.env.GAE_MEMCACHE_HOST + ":" + process.env.GAE_MEMCACHE_PORT;
}
var mc = memjs.Client.create(MEMCACHE_URL);
var dbHost = process.env.DATABASE_HOST;
var dbUser = process.env.DATABASE_USER;
var dbPass = process.env.DATABASE_PASSWORD;
var my_sql_pool = mysql.createPool({
    socketPath: dbHost,
    user: dbUser,
    password: dbPass,
    database: 'Online_Comms',
    supportBigNumbers: true
});
var proxy = httpProxy.createProxyServer({ ws: true });
var accessTokens = [];
var servers = [];
var sIDLookup = {};
var lookUpTable = {};
var connection = mysql.createConnection({
    socketPath: dbHost,
    user: dbUser,
    password: dbPass,
    database: 'Online_Comms',
    supportBigNumbers: true
});
// TODO: Be much more elegent in selection.
function getNewServerId(roomToken) {
    console.log('Getting new server for room: ' + roomToken);
    var pID = lookUpTable[roomToken];
    console.log('Previous server ID was: ' + pID);
    my_sql_pool.getConnection(function (err, connection) {
        if (err) {
            console.log('Error getting databse connection. ' + err);
            return;
        }
        connection.query('USE Online_Comms', function (err) {
            if (err) {
                console.error('Error while setting database schema. ' + err);
                return connection.release();
            }
            connection.query('SELECT * FROM Tutorial_Servers WHERE Server_ID = ?', [pID], function (err, rows, fields) {
                if (err) {
                    console.error('Error making server query. ' + err);
                    return connection.release();
                }
                if (rows[0] == null && rows[0] == undefined) {
                    console.error('Did not find current server.');
                    return connection.release();
                }
                if (rows[0].isUp) {
                    console.error('Current server is fine.');
                    return connection.release();
                }
                connection.query('SELECT * FROM Tutorial_Servers WHERE isUp = ?', [true], function (err, rows, fields) {
                    if (err) {
                        console.error('Error making server query. ' + err);
                        return connection.release();
                    }
                    if (rows[0] == null || rows[0] == undefined) {
                        console.error('Did not find new server.');
                        return connection.release();
                    }
                    console.log('Updating tutorial room: ' + roomToken + ' with current Server_ID: ' + pID + ' to Server_ID: ' + rows[0].Server_ID);
                    connection.query('UPDATE Tutorial_Room_Table SET Server_ID = ? WHERE Server_ID = ? AND Access_Token = ?', [rows[0].Server_ID, pID, roomToken], function (err, rows, fields) {
                        if (err) {
                            console.error('Error making server query. ' + err);
                            return connection.release();
                        }
                        if (rows.length > 0) {
                            mc.set('SID_' + roomToken, '' + rows[0].Server_ID);
                        }
                        connection.query('SELECT * FROM Tutorial_Room_Table WHERE Access_Token = ?', [roomToken], function (err, rows, fields) {
                            if (err) {
                                console.error('Error making server query. ' + err);
                                return connection.release();
                            }
                            if (rows[0] == null || rows[0] == undefined) {
                                console.error('Did not find new server.');
                                return connection.release();
                            }
                            lookUpTable[roomToken] = rows[0].Server_ID;
                            accessTokens[rows[0].Server_ID] = roomToken;
                            if (servers[rows[0].Server_ID] == null || servers[rows[0].Server_ID] == undefined) {
                                connection.query('SELECT * FROM Tutorial_Servers WHERE Server_ID = ?', [rows[0].Server_ID], function (err, rows, fields) {
                                    if (err) {
                                        console.error('Error making server query. ' + err);
                                        return connection.release();
                                    }
                                    if (rows[0] == null || rows[0] == undefined) {
                                        console.error('Did not find server.');
                                        return connection.release();
                                    }
                                    servers[rows[0].Server_ID] = rows[0];
                                    return connection.release();
                                });
                            }
                            else {
                                return connection.release();
                            }
                        });
                    });
                });
            });
        });
    });
}
function serverLookup(tries, roomToken, success, failure) {
    console.log('Looking up server, attempt: ' + tries + ' room: ' + roomToken);
    if (tries > NTRIES) {
        return failure();
    }
    var sID = lookUpTable[roomToken];
    console.log('sID might be: ' + sID);
    if (sID == null || sID == undefined) {
        if ((servers[sID] == null || servers[sID] == undefined || !servers[sID].isUp) && tries > 0) {
            getNewServerId(roomToken);
        }
        serverBackendsIdLookup(tries, roomToken, success, failure);
        return;
    }
    serverDataLookup(tries, sID, roomToken, success, failure);
}
function serverBackendsIdLookup(tries, roomToken, success, failure) {
    console.log('Looking up server ID from databases room: ' + roomToken);
    mc.get('SID_' + roomToken, function (err, sIDS, key) {
        if (err != null || err != undefined) {
            console.error('Error while querying memcached. ' + err);
        }
        if (sIDS == null || sIDS == undefined) {
            my_sql_pool.getConnection(function (err, connection) {
                if (err) {
                    console.log('Error getting databse connection. ' + err);
                    return serverLookup(tries + 1, roomToken, success, failure);
                }
                connection.query('USE Online_Comms', function (err) {
                    if (err) {
                        console.error('Error while setting database schema. ' + err);
                        connection.release();
                        return serverLookup(tries + 1, roomToken, success, failure);
                    }
                    connection.query('SELECT * FROM Tutorial_Room_Table WHERE Access_Token = ?', [roomToken], function (err, rows, fields) {
                        if (err) {
                            console.log('Error looking up room data for: ' + roomToken + '. ' + err);
                            connection.release();
                            return serverLookup(tries + 1, roomToken, success, failure);
                        }
                        if (rows[0] == null || rows[0] == undefined) {
                            console.log('Error did not find room data for: ' + roomToken);
                            connection.release();
                            return serverLookup(tries + 1, roomToken, success, failure);
                        }
                        var sID = rows[0].Server_ID;
                        mc.set('SID_' + roomToken, '' + sID);
                        lookUpTable[roomToken] = sID;
                        accessTokens[rows[0].Server_ID] = roomToken;
                        connection.release();
                        if ((servers[sID] == null || servers[sID] == undefined || !servers[sID].isUp) && tries > 0) {
                            return getNewServerId(roomToken);
                        }
                        serverDataLookup(tries, sID, roomToken, success, failure);
                    });
                });
            });
        }
        else {
            var sID = parseInt(sIDS);
            lookUpTable[roomToken] = sID;
            accessTokens[sID] = roomToken;
            if ((servers[sID] == null || servers[sID] == undefined || !servers[sID].isUp) && tries > 0) {
                return getNewServerId(roomToken);
            }
            serverDataLookup(tries, sID, roomToken, success, failure);
        }
    });
}
;
function serverDataLookup(tries, sID, roomToken, success, failure) {
    var serverData = servers[sID];
    console.log('Looking up server data room: ' + roomToken);
    if (serverData == null || serverData == undefined) {
        return serverBackendDataLookup(tries, sID, roomToken, success, failure);
    }
    if (serverData.isUp) {
        return success(serverData.End_Point, serverData.Port);
    }
    else {
        getNewServerId(roomToken);
        setTimeout(serverLookup, WTIME, tries + 1, roomToken, success, failure);
    }
}
function serverBackendDataLookup(tries, sID, roomToken, success, failure) {
    console.log('Looking up server data from database room: ' + roomToken);
    mc.get('END-POINT_' + sID, function (err, endPoint, key) {
        if (err != null || err != undefined) {
            console.error('Error while querying memcached. ' + err);
            setTimeout(serverLookup, WTIME, tries + 1, roomToken, success, failure);
            return;
        }
        if (endPoint == null || endPoint == undefined) {
            my_sql_pool.getConnection(function (err, connection) {
                if (err) {
                    console.log('Error getting databse connection. ' + err);
                    setTimeout(serverLookup, WTIME, tries + 1, roomToken, success, failure);
                    return;
                }
                connection.query('USE Online_Comms', function (err) {
                    if (err) {
                        console.error('Error while setting database schema. ' + err);
                        connection.release();
                        setTimeout(serverLookup, WTIME, tries + 1, roomToken, success, failure);
                        return;
                    }
                    connection.query('SELECT * FROM Tutorial_Servers WHERE Server_ID = ?', [sID], function (err, rows, fields) {
                        if (err) {
                            console.error('Error making server query. ' + err);
                            connection.release();
                            setTimeout(serverLookup, WTIME, tries + 1, roomToken, success, failure);
                            return;
                        }
                        if (rows[0] == null || rows[0] == undefined) {
                            console.error('Did not find server ID: ' + sID);
                            connection.release();
                            setTimeout(serverLookup, WTIME, tries + 1, roomToken, success, failure);
                            return;
                        }
                        var endPoint = rows[0].End_Point;
                        var port = rows[0].Port;
                        mc.set('END-POINT_' + sID, '' + endPoint);
                        mc.set('PORT_' + sID, '' + port);
                        servers[sID] = rows[0];
                        sIDLookup[endPoint + port] = sID;
                        connection.release();
                        success(endPoint, port);
                    });
                });
            });
            return;
        }
        mc.get('PORT_' + sID, function (err, port, key) {
            if (err != null || err != undefined) {
                console.error('Error while querying memcached. ' + err);
                setTimeout(serverLookup, WTIME, tries + 1, roomToken, success, failure);
                return;
            }
            if (port == null) {
                my_sql_pool.getConnection(function (err, connection) {
                    if (err) {
                        console.log('Error getting databse connection. ' + err);
                        setTimeout(serverLookup, WTIME, tries + 1, roomToken, success, failure);
                        return;
                    }
                    connection.query('USE Online_Comms', function (err) {
                        if (err) {
                            console.error('Error while setting database schema. ' + err);
                            connection.release();
                            setTimeout(serverLookup, WTIME, tries + 1, roomToken, success, failure);
                            return;
                        }
                        connection.query('SELECT * FROM Tutorial_Servers WHERE Server_ID = ?', [sID], function (err, rows, fields) {
                            if (err) {
                                console.error('Error making server query. ' + err);
                                connection.release();
                                setTimeout(serverLookup, WTIME, tries + 1, roomToken, success, failure);
                                return;
                            }
                            if (rows[0] == null || rows[0] == undefined) {
                                console.error('Did not find server ID: ' + sID);
                                connection.release();
                                setTimeout(serverLookup, WTIME, tries + 1, roomToken, success, failure);
                                return;
                            }
                            var endPoint = rows[0].End_Point;
                            var port = rows[0].Port;
                            mc.set('END-POINT_' + sID, '' + endPoint);
                            mc.set('PORT_' + sID, '' + port);
                            servers[sID] = rows[0];
                            sIDLookup[endPoint + port] = sID;
                            connection.release();
                            success(endPoint, port);
                        });
                    });
                });
                return;
            }
            servers[sID] = { Server_ID: sID, End_Point: endPoint, Port: port, Num_Rooms: null, Zone: null, Expected_End: null, isUp: true };
            sIDLookup[endPoint + port] = sID;
            success(endPoint, port);
        });
    });
}
function handleError(endPoint, port) {
    var sID = sIDLookup[endPoint + port];
    console.log("Server is probably down..... Starting recourse.");
    if (servers[sID].isUp) {
        // TODO: Send reload.
        servers[sID].isUp = false;
        mc.set('ISUP_' + sID, '' + false);
        my_sql_pool.getConnection(function (err, connection) {
            if (err) {
                console.log('Error getting databse connection. ' + err);
                return;
            }
            connection.query('USE Online_Comms', function (err) {
                if (err) {
                    console.error('Error while setting database schema. ' + err);
                    return connection.release();
                }
                console.log('Looking up sever ID: ' + sID);
                connection.query('SELECT * FROM Tutorial_Servers WHERE Server_ID = ?', [sID], function (err, rows, fields) {
                    if (err) {
                        console.error('Error making server query. ' + err);
                        return connection.release();
                    }
                    console.log(rows.length);
                    if (rows[0] == null || rows[0] == undefined) {
                        console.error('Error, could not find server ID: ' + sID);
                        return connection.release();
                    }
                    if (!rows[0].isUp) {
                        return connection.release();
                    }
                    connection.query('UPDATE Tutorial_Servers SET isUp = ? WHERE Server_ID = ?', [false, sID], function (err) {
                        if (err) {
                            console.error('Error making server query. ' + err);
                            return connection.release();
                        }
                        connection.release();
                        var roomToken = accessTokens[sID];
                        getNewServerId(roomToken);
                    });
                });
            });
        });
    }
    else {
        // TODO: Another forwarding took this server down, just send reload.
    }
}
var server = http.createServer(function (req, res) {
    var roomToken = req.url.split('roomId=').pop().split('&')[0];
    console.log("Got request... For room: " + roomToken);
    if (roomToken == null || roomToken == undefined || roomToken.length < 2 || !req.url.includes('roomId=')) {
        console.log('Bad room token.');
        console.log('Request url: ' + req.url);
        return;
    }
    serverLookup(0, roomToken, function (endPoint, port) {
        console.log("Found server and forwarding to: " + endPoint);
        var targetServer = 'http://' + endPoint + ':' + port;
        // You can define here your custom logic to handle the request
        // and then proxy the request.
        //console.log('Forwarding http request to: ' + targetServer);
        var respTimeout = setTimeout(function () {
            console.error('Server timed out...');
            handleError(endPoint, port);
        }, 500);
        var reqInt = require('http').get('http://' + endPoint + ':' + port + '/?ServerCheck=1', function (resInt) {
            clearTimeout(respTimeout);
            if (resInt.headers['server-check'] == '1') {
                console.log("Got check respose, response was OK.");
                console.log("Forwarding to: " + targetServer);
                proxy.web(req, res, { target: targetServer });
            }
            else {
                console.log('Server failed response.');
                handleError(endPoint, port);
            }
        });
        reqInt.on('error', function (e) {
            console.error('Server is down...');
            handleError(endPoint, port);
        });
    }, function () {
        return;
    });
});
server.on('upgrade', function (req, socket, head) {
    var roomToken = req.url.split('roomId=').pop().split('&')[0];
    serverLookup(0, roomToken, function (endPoint, port) {
        var targetServer = 'ws://' + endPoint + ':' + port;
        // You can define here your custom logic to handle the request
        // and then proxy the request.
        proxy.ws(req, socket, head, { target: targetServer });
    }, function () {
        return;
    });
});
proxy.on('error', function (err, req, res) {
    res.writeHead(500, {
        'Content-Type': 'text/plain'
    });
    // Server failed, get a new server ID.
    var urlEnd = req.url.split("//").pop();
    var endPoint = urlEnd.split(":")[0];
    var port = urlEnd.split(":").pop().split("/")[0];
    console.log('Proxy Error: ' + err);
    handleError(endPoint, port);
    console.log('PROXY ERROR: ' + err);
    res.end('Something went wrong. And we are reporting a custom error message.');
});
console.log("Started listening on port 9001.");
server.listen(9001);
