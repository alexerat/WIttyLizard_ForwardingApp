var https = require('https');
var httpProxy = require('http-proxy');
var mysql = require('mysql');
var fs = require('fs');
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
var options = {
    key: fs.readFileSync('ssl-key.pem'),
    cert: fs.readFileSync('ssl-cert.pem')
};
var server = https.createServer(options, function (req, res) {
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
                            var targetServer = { host: servers[rows[0].Server_ID].End_Point, port: servers[rows[0].Server_ID].Port };
                            proxy.web(req, res, { target: targetServer });
                        });
                    }
                    else {
                        var targetServer = { host: servers[rows[0].Server_ID].End_Point, port: servers[rows[0].Server_ID].Port };
                        proxy.web(req, res, { target: targetServer });
                    }
                });
            });
        });
    }
    else {
        var sID = lookUpTable[roomToken];
        var targetServer = { host: servers[sID].End_Point, port: servers[sID].Port };
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
                            proxy.ws(req, socket, head, { target: targetServer });
                        });
                    }
                    else {
                        var targetServer = 'http://' + servers[rows[0].Server_ID].End_Point + ':' + servers[rows[0].Server_ID].Port;
                        proxy.ws(req, socket, head, { target: targetServer });
                    }
                });
            });
        });
    }
    else {
        var sID = lookUpTable[roomToken];
        var targetServer = 'http://' + servers[sID].End_Point + ':' + servers[sID].Port;
        proxy.ws(req, socket, head, { target: targetServer });
    }
});
proxy.on('error', function (err, req, res) {
    res.writeHead(500, {
        'Content-Type': 'text/plain'
    });
    res.end('Something went wrong. And we are reporting a custom error message.');
});
console.log("listening on port 443");
server.listen(443);
