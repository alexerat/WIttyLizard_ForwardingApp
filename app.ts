
import { Proxy } from "./typings/proxy";

const http = require('http');
const memjs = require('memjs');
const httpProxy: Proxy.Server = require('http-proxy');
const mysql: MySql.MySqlModule = require('mysql');
const NTRIES = 10;

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

let proxy = httpProxy.createProxyServer({ ws: true });

interface IDictionary {
     [index: string]: number;
}

let servers: Array<SQLTutorialServer> = [];
let sIDLookup: IDictionary = {};
let lookUpTable: IDictionary = {};

let connection = mysql.createConnection({
    socketPath: dbHost,
    user      : dbUser,
    password  : dbPass,
    database  : 'Online_Comms',
    supportBigNumbers: true
});

// TODO: Be much more elegent in selection.
function getNewServerId(roomToken: string) : void
{
    let pID = lookUpTable[roomToken];
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
            if(err)
            {
                console.error('Error while setting database schema. ' + err);
                return connection.release();
            }

            connection.query('SELECT * FROM Tutorial_Servers WHERE Server_ID = ?', [pID],
            (err, rows: Array<SQLTutorialServer>, fields) =>
            {
                if(err)
                {
                    console.error('Error making server query. ' + err);
                    return connection.release();
                }
                if(rows[0] != null && rows[0] != undefined)
                {
                    console.error('Did not find current server.');
                    return connection.release();
                }

                if(rows[0].isUp)
                {
                    console.error('Current server is fine.');
                    return connection.release();
                }

                connection.query('SELECT * FROM Tutorial_Servers WHERE isUp = ?', [true],
                (err, rows: Array<SQLTutorialServer>, fields) =>
                {
                    if(err)
                    {
                        console.error('Error making server query. ' + err);
                        return connection.release();
                    }
                    if(rows[0] == null || rows[0] == undefined)
                    {
                        console.error('Did not find new server.');
                        return connection.release();
                    }

                    

                    connection.query('UPDATE Tutorial_Room_Table SET Server_ID ? WHERE Server_ID = ? Access_Token = ?', [rows[0].Server_ID, pID, roomToken],
                    (err, rows: Array<SQLTutorialRoom>, fields) =>
                    {
                        if(err)
                        {
                            console.error('Error making server query. ' + err);
                            return connection.release();
                        }

                        connection.query('SELECT * FROM Tutorial_Room_Table WHERE Access_Token = ?', [roomToken],
                        (err, rows: Array<SQLTutorialServer>, fields) =>
                        {
                            if(err)
                            {
                                console.error('Error making server query. ' + err);
                                return connection.release();
                            }
                            if(rows[0] == null || rows[0] == undefined)
                            {
                                console.error('Did not find new server.');
                                return connection.release();
                            }

                            lookUpTable[roomToken] = rows[0].Server_ID;
                            if(servers[rows[0].Server_ID] == null || servers[rows[0].Server_ID] == undefined)
                            {
                                connection.query('SELECT * FROM Tutorial_Servers WHERE Server_ID = ?', [rows[0].Server_ID],
                                (err, rows: Array<SQLTutorialServer>, fields) =>
                                {
                                    if(err)
                                    {
                                        console.error('Error making server query. ' + err);
                                        return connection.release();
                                    }
                                    if(rows[0] == null || rows[0] == undefined)
                                    {
                                        console.error('Did not find server.');
                                        return connection.release();
                                    }

                                    servers[rows[0].Server_ID] = rows[0];
                                    return connection.release();
                                });
                            }
                            else
                            {
                                return connection.release();
                            }
                        });
                    });
                });
            });
        });
    });
}

function serverLookup(tries: number, roomToken: string, success: (endpoint, port) => void, failure: () => void) : void
{
    let sID = lookUpTable[roomToken];

    if(sID == null || sID == undefined)
    {
        if(tries > NTRIES)
        {
            return failure();
        }
        if(!servers[sID].isUp || servers[sID] == null || servers[sID] == undefined && tries > 0)
        {
            getNewServerId(roomToken);
        }
        serverBackendsIdLookup(tries, roomToken, success, failure);
        return;
    }

    serverDataLookup(tries, sID, roomToken, success, failure);
}

function serverBackendsIdLookup(tries: number, roomToken: string, success: (endpoint, port) => void, failure: () => void) : void
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
                    return serverLookup(tries + 1, roomToken, success, failure);
                }

                connection.query('USE Online_Comms',
                (err) =>
                {
                    if (err)
                    {
                        console.error('Error while setting database schema. ' + err);
                        connection.release();
                        return serverLookup(tries + 1, roomToken, success, failure);
                    }

                    connection.query('SELECT * FROM Tutorial_Room_Table WHERE Access_Token = ?', [roomToken],
                    (err, rows: Array<SQLTutorialRoom>, fields) =>
                    {
                        if(err)
                        {
                            connection.release();
                            return serverLookup(tries + 1, roomToken, success, failure);
                        }
                        if(rows[0] == null || rows[0] == undefined)
                        {
                            connection.release();
                            return serverLookup(tries + 1, roomToken, success, failure);
                        }

                        sID = rows[0].Server_ID;
                        mc.set('SID_' + roomToken, '' + sID);
                        lookUpTable[roomToken] = sID;

                        connection.release();
                        if(!servers[sID].isUp || servers[sID] == null || servers[sID] == undefined && tries > 0)
                        {
                            sID = getNewServerId(roomToken);
                        }
                        serverDataLookup(tries, sID, roomToken, success, failure);

                    });
                });
            });
        }
        else
        {
            lookUpTable[roomToken] = sID;
            if(!servers[sID].isUp || servers[sID] == null || servers[sID] == undefined && tries > 0)
            {
                sID = getNewServerId(roomToken);
            }
            serverDataLookup(tries, sID, roomToken, success, failure);

        }
    });
};

function serverDataLookup(tries: number, sID: number, roomToken: string, success: (endpoint, port) => void, failure: () => void) : void
{
    let serverData = servers[sID];

    if(serverData == null || serverData == undefined)
    {
        return serverBackendDataLookup(tries, sID, roomToken, success, failure);
    }

    if(serverData.isUp)
    {
        return success(serverData.End_Point, serverData.Port);
    }
    else
    {
        return serverLookup(tries + 1, roomToken, success, failure);
    }
}

function serverBackendDataLookup(tries: number, sID: number, roomToken: string, success: (endpoint, port) => void, failure: () => void) : void
{
    mc.get('END-POINT_' + sID, (err, endPoint, key) =>
    {
        if(err != null || err != undefined)
        {
            console.error('Error while querying memcached. ' + err);
            return serverLookup(tries + 1, roomToken, success, failure);
        }

        if(endPoint == null || endPoint == undefined)
        {
            my_sql_pool.getConnection((err, connection) =>
            {
                if(err)
                {
                    console.log('Error getting databse connection. ' + err);
                    return serverLookup(tries + 1, roomToken, success, failure);
                }

                connection.query('USE Online_Comms',
                (err) =>
                {
                    if (err)
                    {
                        console.error('Error while setting database schema. ' + err);
                        connection.release();
                        return serverLookup(tries + 1, roomToken, success, failure);
                    }

                    connection.query('SELECT * FROM Tutorial_Servers WHERE Server_ID = ?', [sID],
                    (err, rows: Array<SQLTutorialServer>, fields) =>
                    {
                        if(err)
                        {
                            console.error('Error making server query. ' + err);
                            connection.release();
                            return serverLookup(tries + 1, roomToken, success, failure);
                        }
                        if(rows[0] == null || rows[0] == undefined)
                        {
                            console.error('Did not find server ID: ' + sID);
                            connection.release();
                            return serverLookup(tries + 1, roomToken, success, failure);
                        }

                        let endPoint = rows[0].End_Point; 
                        let port = rows[0].Port;

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

        mc.get('PORT_' + sID, (err, port, key) =>
        {
            if(err != null || err != undefined)
            {
                console.error('Error while querying memcached. ' + err);
                return serverLookup(tries + 1, roomToken, success, failure);
            }

            if(port == null)
            {
                my_sql_pool.getConnection((err, connection) =>
                {
                    if(err)
                    {
                        console.log('Error getting databse connection. ' + err);
                        return serverLookup(tries + 1, roomToken, success, failure);
                    }

                    connection.query('USE Online_Comms',
                    (err) =>
                    {
                        if (err)
                        {
                            console.error('Error while setting database schema. ' + err);
                            connection.release();
                            return serverLookup(tries + 1, roomToken, success, failure);
                        }

                        connection.query('SELECT * FROM Tutorial_Servers WHERE Server_ID = ?', [sID],
                        (err, rows: Array<SQLTutorialServer>, fields) =>
                        {
                            if(err)
                            {
                                console.error('Error making server query. ' + err);
                                connection.release();
                                return serverLookup(tries + 1, roomToken, success, failure);
                            }
                            if(rows[0] == null || rows[0] == undefined)
                            {
                                console.error('Did not find server ID: ' + sID);
                                connection.release();
                                return serverLookup(tries + 1, roomToken, success, failure);
                            }

                            let endPoint = rows[0].End_Point; 
                            let port = rows[0].Port;

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

let server = http.createServer(
(req, res) =>
{
    let roomToken = req.url.split('roomId=').pop().split('&')[0];

    serverLookup(0, roomToken, (endPoint, port) => 
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
    let roomToken = req.url.split('roomId=').pop().split('&')[0];

    serverLookup(0, roomToken, (endPoint, port) => 
    {
        let targetServer = 'ws://' + endPoint + ':' + port;
        // You can define here your custom logic to handle the request
        // and then proxy the request.
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

    // Server failed, get a new server ID.
    
    let urlEnd = req.url.split("//").pop();

    let endPoint = urlEnd.split(":")[0];
    let port = urlEnd.split(":").pop().split("/")[0];

    let sID = sIDLookup[endPoint + port];

    if(servers[sID].isUp)
    {
        servers[sID].isUp = false;
        mc.set('ISUP_' + sID, '' + false);

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
                    if(err || rows[0] == null || rows[0] == undefined)
                    {
                        console.error('Error making server query. ' + err);
                        return connection.release();
                    }

                    if(!rows[0].isUp)
                    {
                        return connection.release();
                    }

                    connection.query('SET isUp = ? WHERE Server_ID = ?', [false, sID],
                    (err, rows: Array<SQLTutorialServer>, fields) =>
                    {
                        if(err)
                        {
                            console.error('Error making server query. ' + err);
                            return connection.release();
                        }

                        connection.release();
                    });
                });
            });
        });
    }
    
    console.log('PROXY ERROR: ' + err);

    res.end('Something went wrong. And we are reporting a custom error message.');
});

console.log("Started listening on port 9001.");
server.listen(9001);
