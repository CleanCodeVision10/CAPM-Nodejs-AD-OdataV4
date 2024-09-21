const ldap = require('ldapjs');
const fs = require('fs');
const path = require('path');
const sdkConnectivity = require('@sap-cloud-sdk/connectivity');
const btpCfSocks5ProxyUtils = require('./cfSocks.js');
const xsenv = require('@sap/xsenv');
const logger = cds.log('ad-handler');
const connServiceCredentials = xsenv.serviceCredentials({ tag: 'connectivity' });

const LDAP_CONFIG = {
  idleTimeoutMillisec: 10000,
  ldapsCaFilePath: path.join(__dirname, 'someCertificate.crt'),
  bindUser: process.env.bindUser,
  bindPass: process.env.bindPass,
  ldapsVirtualHost: 'tcp.domain.xyz.com',
  ldapsVirtualPort: 3269,
  ldapsVirtualLocation: 'Domain_Location',
  ldapsRealHost: 'domain.xyz.com',
  ldapsRealPort: 3269,
  base: 'DC=2nd level,DC=1st level',
  scope: 'sub'

};

//User defined varibles in BTP
const maxSizeLimit = parseInt(process.env.sizeLimit, 10);

// Define reusable error handler
const handleError = (errorContext) => (err) => {
  logger.error(`${errorContext}:`, err);
  throw err;
};

function getLdapClient() {
  return createClientObject(LDAP_CONFIG)
    .catch(handleError("Error in LDAP client"));
}

async function createClientObject(options) {
  const tlsOptions = {
    ca: [fs.readFileSync(options.ldapsCaFilePath)],
    host: options.ldapsRealHost,
    port: options.ldapsRealPort,
  };
  const ldapUrl = `ldaps://${tlsOptions.host}:${tlsOptions.port}`;

  const connSvcToken = await sdkConnectivity.serviceToken('connectivity', { useCache: false });

  const info = await btpCfSocks5ProxyUtils.createConnection({
    cc_location: options.ldapsVirtualLocation,
    conn_svc_token: connSvcToken,
    remote_host: options.ldapsVirtualHost,
    remote_port: options.ldapsVirtualPort,
    onpremise_proxy_host: connServiceCredentials.onpremise_proxy_host,
    onpremise_socks5_proxy_port: connServiceCredentials.onpremise_socks5_proxy_port
  });
  // btpCfSocks5ProxyUtils module is used for this. The code is available in SAP Blogs. It is required beforehand but i am not committing this file in this repository
  // Info is creating a socket since BTP doesn't support TCP connection for now. We are calling a Cloud connector using the socks 
  // package through connectivity service. AD configuration must be done before hand.

  return new Promise((resolve, reject) => {
    const ldapClient = ldap.createClient({
      url: ldapUrl,
      tlsOptions: { ...tlsOptions, socket: info.socket }
    });

    ldapClient.bind(options.bindUser, options.bindPass, (err) => {
      if (err) {
        logger.error('Bind error:', err);
        ldapClient.unbind();
        return reject(err);
      }
      logger.debug('Bound to LDAP server');
    });

    ldapClient.once('connect', () => {
      logger.debug(`Connected to LDAP server at ${ldapUrl}`);
      resolve(ldapClient);
    });

    ldapClient.on('error', (err) => {
      logger.error('LDAP client error:', err);
      reject(err);
    });

    ldapClient.on('idle', () => {
      if (ldapClient && !ldapClient.destroy) {
        logger.debug('Idle: Destroying LDAP client');
        const e = new Error('idle');
        ldapClient.destroy(e);
        reject(e);
      }
    });
  })
    .catch(handleError('Failed to create LDAP client'));
}
function searchLdap(base, scope, filter) {
  return getLdapClient()
    .then(client => {
  
      return new Promise((resolve, reject) => {
        const entries = [];
        client.search(base, {
          scope: scope,
          filter: filter,
          attributes: ['cn', 'memberOf', 'firstname', 'lastname', 'mail'], // attributes to fetch in entry.Object for each entry from Active Directory
          sizeLimit: maxSizeLimit ,
          paged:false 
        }, async (err, res) => {
          if (err) {
            logger.error('Search error in searchLdap:', err);
            await client.unbind(); 
            reject(err);
          }
          res.on('searchEntry', (entry) => {       
            entries.push({
              jsonData: JSON.stringify(entry.object)
            });
            logger.debug('Search result entry:', entry.object);
          });
          res.on('error', async (err) => {
            logger.error('Search result error:', err.message);
            await client.unbind(); 
            reject(err);
          });
          res.on('end', async (result) => {
            logger.debug("Search result 'end' status:", result.status);
            await client.unbind(); 
            resolve(entries);
          });
          res.on('close', async (result) => {
            logger.debug("Search result 'close' status:", result.status);
            await client.unbind(); 
            reject(new Error('Socket closed'));
            // }
          });
        });
      }).finally(async () => {
       
      });
    });
}
function getUsersInRole(roleAdGroup, attributesToRead) {
  if (attributesToRead) {
    return searchLdapWithUserID(
      LDAP_CONFIG.base,
      LDAP_CONFIG.scope,
      `(&(objectClass=user)(sAMAccountName=${attributesToRead})(memberof=CN=${roleAdGroup},cn=read-only-admin,dc=example,dc=com))`
    )
      .then(entries => {
        const messageInfo = entries.map(entry => {
          return { message: entry };
        });
        return messageInfo;
      })
      .catch(handleError('Error fetching users of role'));
  }
  else {
    return searchLdap(
      LDAP_CONFIG.base,
      LDAP_CONFIG.scope,
      `(&(objectClass=user)(memberof=CN=${roleAdGroup},cn=read-only-admin,dc=example,dc=com))`
    )
      .then(entries => {
        const users = entries.map(entry => {
          const ldapData = JSON.parse(entry.jsonData);
          return { ...ldapData, id: ldapData.cn };
        });

        users.sort((a, b) => a.id.localeCompare(b.id));
        return users;
      })
      .catch(handleError('Error fetching users of role'));
  }
}

function searchLdapWithUserID(base, scope, filter) { 
  return getLdapClient()
    .then(client => {
     
      return new Promise((resolve, reject) => {
        const entries = [];
        entries[0] = "User id Not Found";

        client.search(base, {
          scope: scope,
          filter: filter,
          sizeLimit: maxSizeLimit,
          paged:false
        }, async (err, res) => {
          if (err) {
            logger.error('Search error in searchLdapWithUserID:', err);
            await client.unbind();
            reject(err);
          }
          res.on('searchEntry', (entry) => {

            entries[0] = "User id is present!";
            logger.debug('Search result entry:', entry.object);
          });
          res.on('error', async (err) => {
            logger.error('Search result error:', err.message);
            await client.unbind();
            reject(err);
          });
          res.on('end', async (result) => {
            logger.debug("Search result 'end' status:", result.status);
            await client.unbind();
            resolve(entries);
          });
          res.on('close', async (result) => {
            logger.debug("Search result 'close' status:", result.status);
            await client.unbind();
            reject(new Error('Socket closed'));
          });
        });
      }).finally(async () => {
      });
    });
}
function buildLdapFilter(usernames) {
  const filterParts = usernames.map(username => `(sAMAccountName=${username})`);
  return `(&(objectClass=user)(|${filterParts.join('')}))`;
}

function getUserInfo(attributesToRead) {
  const aUserFilter = buildLdapFilter(attributesToRead);
  if(attributesToRead.length > 50) {throw new Error("Error. Maximum count limit reached!");}

  return searchLdap(
    LDAP_CONFIG.base,
    LDAP_CONFIG.scope,
    aUserFilter
  )
    .then(entries => {
      let users = [];
      users = entries.map(entry => {
        const ldapData = JSON.parse(entry.jsonData);
        return { ...ldapData, firstName: ldapData.rocheLegalGivenName, lastName: ldapData.rocheLegalSurname, email: ldapData.mail,id:ldapData.cn };
      });
      return users;
    })
    .catch(handleError('Error fetching users Details'));
}

function getUserGroups(attributesToRead) {
  return searchLdap(
    LDAP_CONFIG.base,
    LDAP_CONFIG.scope,
    `(&(objectClass=user)(sAMAccountName=${attributesToRead}))`
  )
    .then(entries => {
      let aGroups = [];
      aGroups = entries.map(entry => {
        const ldapData = JSON.parse(entry.jsonData);
        const aMemberOf = ldapData.memberOf;
        const modifiedList = [];
        aMemberOf.forEach(element => {
          const parts = element.split(',');
          let tArray = parts[0];
          tArray = tArray.split('=');
          modifiedList.push(tArray[1]);
        });
        return { ...ldapData, aMemberOf: modifiedList };
      });
      if (aGroups.length === 0) {
        return [];
      }
      return aGroups[0].aMemberOf;
    })
    .catch(handleError('Error fetching users Details'));
}

module.exports = {
  getUsersInRole,
  getUserInfo,
  getUserGroups
};



