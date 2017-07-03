"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var http = require('http');
var memjs = require('memjs');
var httpProxy = require('http-proxy');
var mysql = require('mysql');
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
var proxy = httpProxy.createProxyServer({});
var servers = [];
var lookUpTable = {};
var connection = mysql.createConnection({
    socketPath: dbHost,
    user: dbUser,
    password: dbPass,
    database: 'Online_Comms',
    supportBigNumbers: true
});
function serverLookup(roomToken, success, failure) {
    var sID = lookUpTable[roomToken];
    if (sID == null || sID == undefined) {
        return serverBackendsIdLookup(roomToken, success, failure);
    }
    serverDataLookup(sID, success, failure);
}
function serverBackendsIdLookup(roomToken, success, failure) {
    mc.get('SID_' + roomToken, function (err, sID, key) {
        if (err != null || err != undefined) {
            console.error('Error while querying memcached. ' + err);
        }
        if (sID == null || sID == undefined) {
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
                    connection.query('SELECT * FROM Tutorial_Room_Table WHERE Access_Token = ?', [roomToken], function (err, rows, fields) {
                        if (err) {
                            return connection.release();
                        }
                        if (rows[0] == null || rows[0] == undefined) {
                            return connection.release();
                        }
                        sID = rows[0].Server_ID;
                        mc.set('SID_' + roomToken, '' + sID);
                        lookUpTable[roomToken] = sID;
                        serverDataLookup(sID, success, failure);
                    });
                });
            });
        }
        else {
            lookUpTable[roomToken] = sID;
            serverDataLookup(sID, success, failure);
        }
    });
}
;
function serverDataLookup(sID, success, failure) {
    var serverData = servers[sID];
    if (serverData == null || serverData == undefined) {
        return serverBackendDataLookup(sID, success, failure);
    }
    success(serverData.End_Point, serverData.Port);
}
function serverBackendDataLookup(sID, success, failure) {
    mc.get('END-POINT_' + sID, function (err, endPoint, key) {
        if (err != null || err != undefined) {
            console.error('Error while querying memcached. ' + err);
            return;
        }
        if (endPoint == null || endPoint == undefined) {
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
                    connection.query('SELECT * FROM Tutorial_Servers WHERE Server_ID = ?', [sID], function (err, rows, fields) {
                        if (err) {
                            console.error('Error making server query. ' + err);
                            return connection.release();
                        }
                        if (rows[0] == null || rows[0] == undefined) {
                            console.error('Did not find server ID: ' + sID);
                            return connection.release();
                        }
                        var endPoint = rows[0].End_Point;
                        var port = rows[0].Port;
                        mc.set('END-POINT_' + sID, '' + endPoint);
                        mc.set('PORT_' + sID, '' + port);
                        servers[sID] = rows[0];
                        success(endPoint, port);
                    });
                });
            });
            return;
        }
        mc.get('PORT_' + sID, function (err, port, key) {
            if (err != null || err != undefined) {
                console.error('Error while querying memcached. ' + err);
                return;
            }
            if (port == null) {
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
                        connection.query('SELECT * FROM Tutorial_Servers WHERE Server_ID = ?', [sID], function (err, rows, fields) {
                            if (err) {
                                console.error('Error making server query. ' + err);
                                return connection.release();
                            }
                            if (rows[0] == null || rows[0] == undefined) {
                                console.error('Did not find server ID: ' + sID);
                                return connection.release();
                            }
                            var endPoint = rows[0].End_Point;
                            var port = rows[0].Port;
                            mc.set('END-POINT_' + sID, '' + endPoint);
                            mc.set('PORT_' + sID, '' + port);
                            servers[sID] = rows[0];
                            success(endPoint, port);
                        });
                    });
                });
                return;
            }
            servers[sID] = { Server_ID: sID, End_Point: endPoint, Port: port, Num_Rooms: null, Zone: null, Expected_End: null, isUp: null };
            success(endPoint, port);
        });
    });
}
var server = http.createServer(function (req, res) {
    var roomToken = req.url.split('roomId=').pop().split('&')[0];
    serverLookup(roomToken, function (endPoint, port) {
        var targetServer = 'http://' + endPoint + ':' + port;
        // You can define here your custom logic to handle the request
        // and then proxy the request.
        //console.log('Forwarding http request to: ' + targetServer);
        proxy.web(req, res, { target: targetServer });
    }, function () {
        return;
    });
});
server.on('upgrade', function (req, socket, head) {
    var roomToken = req.url.split('/').pop().split('?')[0];
    serverLookup(roomToken, function (endPoint, port) {
        var targetServer = 'ws://' + endPoint + ':' + port;
        // You can define here your custom logic to handle the request
        // and then proxy the request.
        //console.log('Forwarding websocket request to: ' + targetServer);
        proxy.ws(req, socket, head, { target: targetServer });
    }, function () {
        return;
    });
});
proxy.on('error', function (err, req, res) {
    res.writeHead(500, {
        'Content-Type': 'text/plain'
    });
    console.log('PROXY ERROR: ' + err);
    res.end('Something went wrong. And we are reporting a custom error message.');
});
console.log("Started listening on port 9001.");
server.listen(9001);
