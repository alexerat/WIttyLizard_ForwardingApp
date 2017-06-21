
import { Proxy } from "./typings/proxy";

const http = require('http');
const httpProxy: Proxy.Server = require('http-proxy');
const mysql: MySql.MySqlModule = require('mysql');

let dbHost = process.env.DATABASE_HOST;
let dbUser = process.env.DATABASE_USER;
let dbPass = process.env.DATABASE_PASSWORD;

let my_sql_pool = mysql.createPool({
  host     : dbHost,
  user     : dbUser,
  password : dbPass,
  database : 'Online_Comms',
  supportBigNumbers: true
});

let proxy = httpProxy.createProxyServer({});

interface IDictionary {
     [index: string]: number;
}

let servers: Array<SQLTutorialServer> = [];
let lookUpTable: IDictionary = {};


let server = http.createServer(
(req, res) =>
{
    let roomToken = 'split rq here';

    console.log('Started trying to foward.');
    console.log('Request: ' + req);

    if(lookUpTable[roomToken] == null || lookUpTable[roomToken] == undefined)
    {
        my_sql_pool.getConnection((err, connection) =>
        {
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
                                console.error('Did not find server ID: ' + rows[0].Server_ID);
                                return connection.release();
                            }

                            servers[rows[0].Server_ID] = rows[0];

                            let targetServer = servers[rows[0].Server_ID].End_Point + ":" + servers[rows[0].Server_ID].Port;
                            // You can define here your custom logic to handle the request
                            // and then proxy the request.
                            proxy.web(req, res, { target: targetServer });
                        });
                    }
                    else
                    {
                        let targetServer = servers[rows[0].Server_ID].End_Point + ":" + servers[rows[0].Server_ID].Port;
                        // You can define here your custom logic to handle the request
                        // and then proxy the request.
                        proxy.web(req, res, { target: targetServer });
                    }
                });
            });
        });
    }
    else
    {
        let sID = lookUpTable[roomToken];
        let targetServer = servers[sID].End_Point + ":" + servers[sID].Port;

        // You can define here your custom logic to handle the request
        // and then proxy the request.
        proxy.web(req, res, { target: targetServer });
    }
});

server.on('upgrade',
(req, socket, head) =>
{
    let roomToken = 'split rq here';

    console.log('Started trying to foward.');
    console.log('Request: ' + req);

    if(lookUpTable[roomToken] == null || lookUpTable[roomToken] == undefined)
    {
        my_sql_pool.getConnection((err, connection) =>
        {
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
                                console.error('Did not find server ID: ' + rows[0].Server_ID);
                                return connection.release();
                            }

                            servers[rows[0].Server_ID] = rows[0];

                            let targetServer = 'http://' + servers[rows[0].Server_ID].End_Point + ':' + servers[rows[0].Server_ID].Port;
                            // You can define here your custom logic to handle the request
                            // and then proxy the request.
                            proxy.ws(req, socket, head, { target: targetServer });
                        });
                    }
                    else
                    {
                        let targetServer = 'http://' + servers[rows[0].Server_ID].End_Point + ':' + servers[rows[0].Server_ID].Port;
                        // You can define here your custom logic to handle the request
                        // and then proxy the request.
                        proxy.ws(req, socket, head, { target: targetServer });
                    }
                });
            });
        });
    }
    else
    {
        let sID = lookUpTable[roomToken];
        let targetServer = 'http://' + servers[sID].End_Point + ':' + servers[sID].Port;

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

console.log("listening on port 9001")
server.listen(9001);
