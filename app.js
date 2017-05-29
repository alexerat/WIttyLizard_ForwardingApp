"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var http = require('http');
var httpProxy = require('http-proxy');
var mysql = require('mysql');
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
var server = http.createServer(function (req, res) {
    var roomToken = 'split rq here';
    if (lookUpTable[roomToken] == null || lookUpTable[roomToken] == undefined) {
        my_sql_pool.getConnection(function (err, connection) {
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
                    lookUpTable[roomToken] = rows[0].Server_ID;
                    if (servers[rows[0].Server_ID] == null || servers[rows[0].Server_ID] == undefined) {
                        connection.query('SELECT * FROM Tutorial_Servers WHERE Server_ID = ?', [rows[0].Server_ID], function (err, rows, fields) {
                            if (err) {
                                console.error('Error making server query. ' + err);
                                return connection.release();
                            }
                            if (rows[0] == null || rows[0] == undefined) {
                                console.error('Did not find server ID: ' + rows[0].Server_ID);
                                return connection.release();
                            }
                            servers[rows[0].Server_ID] = rows[0];
                            var targetServer = servers[rows[0].Server_ID].End_Point + ":" + servers[rows[0].Server_ID].Port;
                            // You can define here your custom logic to handle the request
                            // and then proxy the request.
                            proxy.web(req, res, { target: targetServer });
                        });
                    }
                    else {
                        var targetServer = servers[rows[0].Server_ID].End_Point + ":" + servers[rows[0].Server_ID].Port;
                        // You can define here your custom logic to handle the request
                        // and then proxy the request.
                        proxy.web(req, res, { target: targetServer });
                    }
                });
            });
        });
    }
    else {
        var sID = lookUpTable[roomToken];
        var targetServer = servers[sID].End_Point + ":" + servers[sID].Port;
        // You can define here your custom logic to handle the request
        // and then proxy the request.
        proxy.web(req, res, { target: targetServer });
    }
});
server.on('upgrade', function (req, socket, head) {
    var roomToken = 'split rq here';
    if (lookUpTable[roomToken] == null || lookUpTable[roomToken] == undefined) {
        my_sql_pool.getConnection(function (err, connection) {
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
                    lookUpTable[roomToken] = rows[0].Server_ID;
                    if (servers[rows[0].Server_ID] == null || servers[rows[0].Server_ID] == undefined) {
                        connection.query('SELECT * FROM Tutorial_Servers WHERE Server_ID = ?', [rows[0].Server_ID], function (err, rows, fields) {
                            if (err) {
                                console.error('Error making server query. ' + err);
                                return connection.release();
                            }
                            if (rows[0] == null || rows[0] == undefined) {
                                console.error('Did not find server ID: ' + rows[0].Server_ID);
                                return connection.release();
                            }
                            servers[rows[0].Server_ID] = rows[0];
                            var targetServer = 'http://' + servers[rows[0].Server_ID].End_Point + ':' + servers[rows[0].Server_ID].Port;
                            // You can define here your custom logic to handle the request
                            // and then proxy the request.
                            proxy.ws(req, socket, head, { target: targetServer });
                        });
                    }
                    else {
                        var targetServer = 'http://' + servers[rows[0].Server_ID].End_Point + ':' + servers[rows[0].Server_ID].Port;
                        // You can define here your custom logic to handle the request
                        // and then proxy the request.
                        proxy.ws(req, socket, head, { target: targetServer });
                    }
                });
            });
        });
    }
    else {
        var sID = lookUpTable[roomToken];
        var targetServer = 'http://' + servers[sID].End_Point + ':' + servers[sID].Port;
        // You can define here your custom logic to handle the request
        // and then proxy the request.
        proxy.ws(req, socket, head, { target: targetServer });
    }
});
proxy.on('error', function (err, req, res) {
    res.writeHead(500, {
        'Content-Type': 'text/plain'
    });
    res.end('Something went wrong. And we are reporting a custom error message.');
});
console.log("listening on port 9001");
server.listen(9001);
