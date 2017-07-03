
import { Proxy } from "./typings/proxy";

const http = require('http');
const memjs = require('memjs');
const httpProxy: Proxy.Server = require('http-proxy');
const mysql: MySql.MySqlModule = require('mysql');

// Environment variables are defined in app.yaml.
let MEMCACHE_URL = process.env.MEMCACHE_URL || '127.0.0.1:11211';

if (process.env.USE_GAE_MEMCACHE) {
  MEMCACHE_URL = `${process.env.GAE_MEMCACHE_HOST}:${process.env.GAE_MEMCACHE_PORT}`;
}

const mc = memjs.Client.create(MEMCACHE_URL);

let dbHost = process.env.DATABASE_HOST;
let dbUser = process.env.DATABASE_USER;
let dbPass = process.env.DATABASE_PASSWORD;

let my_sql_pool = mysql.createPool({
  socketPath: dbHost,
  user      : dbUser,
  password  : dbPass,
  database  : 'Online_Comms',
  supportBigNumbers: true
});

let proxy = httpProxy.createProxyServer({});

interface IDictionary {
     [index: string]: number;
}

let servers: Array<SQLTutorialServer> = [];
let lookUpTable: IDictionary = {};

let connection = mysql.createConnection({
    socketPath: dbHost,
    user      : dbUser,
    password  : dbPass,
    database  : 'Online_Comms',
    supportBigNumbers: true
});

function serverLookup(roomToken: string, success: (endpoint, port) => void, failure: () => void) 
{
    let sID = lookUpTable[roomToken];

    if(sID == null || sID == undefined)
    {
        return serverBackendsIdLookup(roomToken, success, failure);
    }

    serverDataLookup(sID, success, failure);
}

function serverBackendsIdLookup(roomToken: string, success: (endpoint, port) => void, failure: () => void) 
{
    mc.get('SID_' + roomToken, (err, sID, key) =>
    {
        if(err != null || err != undefined)
        {
            console.error('Error while querying memcached. ' + err);
        }

        if(sID == null || sID == undefined)
        {
            my_sql_pool.getConnection((err, connection) =>
            {
                if(err)
                {
                    console.log('Error getting databse connection. ' + err);
                    return;
                }

                connection.query('USE Online_Comms',
                (err) =>
                {
                    if (err)
                    {
                        console.error('Error while setting database schema. ' + err);
                        return connection.release();
                    }

                    connection.query('SELECT * FROM Tutorial_Room_Table WHERE Access_Token = ?', [roomToken],
                    (err, rows: Array<SQLTutorialRoom>, fields) =>
                    {
                        if(err)
                        {
                            return connection.release();
                        }
                        if(rows[0] == null || rows[0] == undefined)
                        {
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
        else
        {
            serverDataLookup(sID, success, failure);
        }
    });
};

function serverDataLookup(sID: number, success: (endpoint, port) => void, failure: () => void) 
{
    let serverData = servers[sID];

    if(serverData == null || serverData == undefined)
    {
        return serverBackendDataLookup(sID, success, failure);
    }

    success(serverData.End_Point, serverData.Port);
}

function serverBackendDataLookup(sID: number, success: (endpoint, port) => void, failure: () => void) 
{
    mc.get('END-POINT_' + sID, (err, endPoint, key) =>
    {
        if(err != null || err != undefined)
        {
            console.error('Error while querying memcached. ' + err);
            return;
        }

        if(endPoint == null || endPoint == undefined)
        {
            my_sql_pool.getConnection((err, connection) =>
            {
                if(err)
                {
                    console.log('Error getting databse connection. ' + err);
                    return;
                }

                connection.query('USE Online_Comms',
                (err) =>
                {
                    if (err)
                    {
                        console.error('Error while setting database schema. ' + err);
                        return connection.release();
                    }

                    connection.query('SELECT * FROM Tutorial_Servers WHERE Server_ID = ?', [sID],
                    (err, rows: Array<SQLTutorialServer>, fields) =>
                    {
                        if(err)
                        {
                            console.error('Error making server query. ' + err);
                            return connection.release();
                        }
                        if(rows[0] == null || rows[0] == undefined)
                        {
                            console.error('Did not find server ID: ' + sID);
                            return connection.release();
                        }

                        let endPoint = rows[0].End_Point; 
                        let port = rows[0].Port;

                        mc.set('END-POINT_' + sID, '' + endPoint);
                        mc.set('PORT_' + sID, '' + port);
                        servers[sID] = rows[0];

                        success(endPoint, port);
                    });
                });
            });
            return;
        }

        mc.get('PORT_' + sID, (err, port, key) =>
        {
            if(err != null || err != undefined)
            {
                console.error('Error while querying memcached. ' + err);
                return;
            }

            if(port == null)
            {
                my_sql_pool.getConnection((err, connection) =>
                {
                    if(err)
                    {
                        console.log('Error getting databse connection. ' + err);
                        return;
                    }

                    connection.query('USE Online_Comms',
                    (err) =>
                    {
                        if (err)
                        {
                            console.error('Error while setting database schema. ' + err);
                            return connection.release();
                        }

                        connection.query('SELECT * FROM Tutorial_Servers WHERE Server_ID = ?', [sID],
                        (err, rows: Array<SQLTutorialServer>, fields) =>
                        {
                            if(err)
                            {
                                console.error('Error making server query. ' + err);
                                return connection.release();
                            }
                            if(rows[0] == null || rows[0] == undefined)
                            {
                                console.error('Did not find server ID: ' + sID);
                                return connection.release();
                            }

                            let endPoint = rows[0].End_Point; 
                            let port = rows[0].Port;

                            mc.set('END-POINT_' + sID, '' + endPoint);
                            mc.set('PORT_' + sID, '' + port);
                            servers[sID] = rows[0];

                            success(endPoint, port);
                        });
                    });
                });
                return;
            }

            success(endPoint, port);
        });
    });
}



let server = http.createServer(
(req, res) =>
{
    let roomToken = req.url.split('roomId=').pop().split('&')[0];

    serverLookup(roomToken, (endPoint, port) => 
    {
        let targetServer = 'http://' + endPoint + ':' + port;
        // You can define here your custom logic to handle the request
        // and then proxy the request.
        //console.log('Forwarding http request to: ' + targetServer);
        proxy.web(req, res, { target: targetServer });
    }, () =>
    {
        return;
    });
});

server.on('upgrade',
(req, socket, head) =>
{
    let roomToken = req.url.split('/').pop().split('?')[0];

    serverLookup(roomToken, (endPoint, port) => 
    {
        let targetServer = 'ws://' + endPoint + ':' + port;
        // You can define here your custom logic to handle the request
        // and then proxy the request.
        //console.log('Forwarding websocket request to: ' + targetServer);
        proxy.ws(req, socket, head, { target: targetServer });
    }, () =>
    {
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
