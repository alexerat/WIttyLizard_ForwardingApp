
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

function serverLookup(roomToken: string, success: (endpoint, port) => void) {
    console.log('Looking up server....');
    mc.get('SID_' + roomToken, (err, sID, key) =>
    {
        
        if(err != null || err != undefined)
        {
            console.error('Error while querying memcached. ' + err);
        }

        if(sID == null)
        {
            
            my_sql_pool.getConnection((err, connection) =>
            {
                if(err)
                {
                    console.log('Error getting databse connection. ' + err);
                    console.log(dbHost);
                    console.log(dbUser);
                    console.log(dbPass);
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

                        console.log('Found server ID in database: ' + rows[0].Server_ID);

                        let sId = rows[0].Server_ID;

                        console.log('Looking up address....');

                        mc.get('END-POINT_' + sID, (err, endPoint, key) =>
                        {
                            if(err != null || err != undefined)
                            {
                                console.error('Error while querying memcached. ' + err);
                            }

                            if(endPoint == null)
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
                                        console.error('Did not find server ID: ' + rows[0].Server_ID);
                                        return connection.release();
                                    }

                                    endPoint = rows[0].End_Point; 
                                    let port = rows[0].Port;

                                    mc.set('END-POINT_' + sID, endPoint);
                                    mc.set('PORT_' + sID, port);
                                    mc.set('SID_' + roomToken, sId);

                                    console.log('Got everything!');
                                    success(endPoint, port);
                                });
                            }
                            else
                            {
                                mc.get('PORT_' + sID, (err, port, key) =>
                                {
                                    if(err != null || err != undefined)
                                    {
                                        console.error('Error while querying memcached. ' + err);
                                    }

                                    if(port == null)
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
                                    else
                                    {
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
        else
        {
            console.log('Got server ID from memcache, looking up address....');
            mc.get('END-POINT_' + sID, (err, endPoint, key) =>
            {
                if(err != null || err != undefined)
                {
                    console.error('Error while querying memcached. ' + err);
                }

                if(endPoint == null)
                {
                    console.error('Error while querying memcached. End Point is null.');
                }

                mc.get('PORT_' + sID, (err, port, key) =>
                {
                    if(err != null || err != undefined)
                    {
                        console.error('Error while querying memcached. ' + err);
                    }

                    if(port == null)
                    {
                        console.error('Error while querying memcached. Port is null.');
                    }

                    console.log('Got everything!');
                    success(endPoint, port);
                });
            });
        }
    });
};

let server = http.createServer(
(req, res) =>
{
    let roomToken = req.url.split('/').pop().split('?')[0];

    console.log('Started trying to foward.');
    console.log('Request: ' + req);

    serverLookup(roomToken, (endPoint, port) => 
    {
        let targetServer = endPoint + ":" + port;
        // You can define here your custom logic to handle the request
        // and then proxy the request.
        proxy.web(req, res, { target: targetServer });
    });
});

server.on('upgrade',
(req, socket, head) =>
{
    let roomToken = req.url.split('/').pop().split('?')[0];

    console.log('Started trying to foward.');
    console.log('Request: ' + req);

    serverLookup(roomToken, (endPoint, port) => 
    {
        let targetServer = 'http://' + endPoint + ':' + port;
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
