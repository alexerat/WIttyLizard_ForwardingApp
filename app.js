"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require('@google-cloud/debug-agent').start();
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
    host: dbHost,
    user: dbUser,
    password: dbPass,
    database: 'Online_Comms',
    supportBigNumbers: true
});
var proxy = httpProxy.createProxyServer({});
var servers = [];
var lookUpTable = {};
function serverLookup(roomToken, success) {
    console.log('Looking up server....');
    mc.get('SID_' + roomToken, function (err, sID, key) {
        if (err != null || err != undefined) {
            console.error('Error while querying memcached. ' + err);
        }
        if (sID == null) {
            my_sql_pool.getConnection(function (err, connection) {
                if (err) {
                    console.log('Error getting databse connection. ' + err);
                    console.log(dbHost);
                    console.log(dbUser);
                    console.log(dbPass);
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
                        console.log('Found server ID in database: ' + rows[0].Server_ID);
                        var sId = rows[0].Server_ID;
                        console.log('Looking up address....');
                        mc.get('END-POINT_' + sID, function (err, endPoint, key) {
                            if (err != null || err != undefined) {
                                console.error('Error while querying memcached. ' + err);
                            }
                            if (endPoint == null) {
                                connection.query('SELECT * FROM Tutorial_Servers WHERE Server_ID = ?', [rows[0].Server_ID], function (err, rows, fields) {
                                    if (err) {
                                        console.error('Error making server query. ' + err);
                                        return connection.release();
                                    }
                                    if (rows[0] == null || rows[0] == undefined) {
                                        console.error('Did not find server ID: ' + rows[0].Server_ID);
                                        return connection.release();
                                    }
                                    endPoint = rows[0].End_Point;
                                    var port = rows[0].Port;
                                    mc.set('END-POINT_' + sID, endPoint);
                                    mc.set('PORT_' + sID, port);
                                    mc.set('SID_' + roomToken, sId);
                                    console.log('Got everything!');
                                    success(endPoint, port);
                                });
                            }
                            else {
                                mc.get('PORT_' + sID, function (err, port, key) {
                                    if (err != null || err != undefined) {
                                        console.error('Error while querying memcached. ' + err);
                                    }
                                    if (port == null) {
                                        connection.query('SELECT * FROM Tutorial_Servers WHERE Server_ID = ?', [rows[0].Server_ID], function (err, rows, fields) {
                                            if (err) {
                                                console.error('Error making server query. ' + err);
                                                return connection.release();
                                            }
                                            if (rows[0] == null || rows[0] == undefined) {
                                                console.error('Did not find server ID: ' + rows[0].Server_ID);
                                                return connection.release();
                                            }
                                            endPoint = rows[0].End_Point;
                                            port = rows[0].Port;
                                            mc.set('END-POINT_' + sID, endPoint);
                                            mc.set('PORT_' + sID, port);
                                            mc.set('SID_' + roomToken, sId);
                                            console.log('Got everything!');
                                            success(endPoint, port);
                                        });
                                    }
                                    else {
                                        mc.set('SID_' + roomToken, sId);
                                        console.log('Got everything!');
                                        success(endPoint, port);
                                    }
                                });
                            }
                        });
                    });
                });
            });
        }
        else {
            console.log('Got server ID from memcache, looking up address....');
            mc.get('END-POINT_' + sID, function (err, endPoint, key) {
                if (err != null || err != undefined) {
                    console.error('Error while querying memcached. ' + err);
                }
                if (endPoint == null) {
                    console.error('Error while querying memcached. ' + err);
                }
                mc.get('PORT_' + sID, function (err, port, key) {
                    if (err != null || err != undefined) {
                        console.error('Error while querying memcached. ' + err);
                    }
                    if (port == null) {
                        console.error('Error while querying memcached. ' + err);
                    }
                    console.log('Got everything!');
                    success(endPoint, port);
                });
            });
        }
    });
}
;
var server = http.createServer(function (req, res) {
    var roomToken = req.url.split('/').pop();
    console.log('Started trying to foward.');
    console.log('Request: ' + req);
    serverLookup(roomToken, function (endPoint, port) {
        var targetServer = endPoint + ":" + port;
        // You can define here your custom logic to handle the request
        // and then proxy the request.
        proxy.web(req, res, { target: targetServer });
    });
});
server.on('upgrade', function (req, socket, head) {
    var roomToken = req.url.split('/').pop();
    console.log('Started trying to foward.');
    console.log('Request: ' + req);
    serverLookup(roomToken, function (endPoint, port) {
        var targetServer = 'http://' + endPoint + ':' + port;
        // You can define here your custom logic to handle the request
        // and then proxy the request.
        proxy.ws(req, socket, head, { target: targetServer });
    });
});
proxy.on('error', function (err, req, res) {
    res.writeHead(500, {
        'Content-Type': 'text/plain'
    });
    res.end('Something went wrong. And we are reporting a custom error message.');
});
console.log("listening on port 9001");
server.listen(9001);
