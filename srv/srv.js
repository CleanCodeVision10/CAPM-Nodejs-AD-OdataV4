const ldap = require('./AD.js');
const logger = cds.log('ad-handler');
const { Mutex } = require('async-mutex');

const mutex = new Mutex();

module.exports = (apicall) => {

    // Get all users present inside the AD group. Default Limit is 1000 entries.
    // Also can pass the user name to confirm it's presence in case search breaches the max limit
    apicall.on('getUsersInRole', async (req) => {
        logger.info('Attempting to acquire mutex for getUsersInRole');
        const release = await mutex.acquire();
        try {
            logger.info('Mutex acquired for getUsersInRole');
            if (req.data.roleAdGroup === '' || req.data.roleAdGroup === undefined) {
                return { message: "Please enter the required information!" };
            }
            return await ldap.getUsersInRole(req.data.roleAdGroup, req.data.username);

        } catch (error) {
            logger.error(`Something wrong in getUsersInRole: ${error}`);
            req.error({
                code: 500,
                message: `Failed to fetch users: ${error.message}`
            });
        } finally {
            release();
            logger.info('Mutex released for getUsersInRole');
        }
    });
    // Get user information stored through sAMAccountName key and objectClass=user type inside the AD
    apicall.on('getUserInfo', async (req) => {
        logger.info('Attempting to acquire mutex for getUserInfo');
        const release = await mutex.acquire();
        try {
            logger.info('Mutex acquired for getUserInfo');

            if (req.data.username.length === 0) {
                return { message: "Please enter the required information!" };
            }
            return await ldap.getUserInfo(req.data.username);

        } catch (error) {
            logger.error(`Something wrong in getUserInfo: ${error}`);
            req.error({
                code: 500,
                message: `Failed to fetch user info: ${error.message}`
            });
        } finally {
            release();
            logger.info('Mutex released for getUserInfo');
        }
    });


    // Get user's all allocated groups stored through sAMAccountName key and objectClass=user type inside the AD

    apicall.on('getUserGroups', async (req) => {
        logger.info('Attempting to acquire mutex for getUserGroups');
        const release = await mutex.acquire();
        try {
            logger.info('Mutex acquired for getUserGroups');

            if (req.data.username === '' || req.data.username === undefined) {
                return { message: "Please enter the required information!" };
            }
            return await ldap.getUserGroups(req.data.username);

        } catch (error) {
            logger.error(`Something wrong in getUserGroups: ${error}`);
            req.error({
                code: 500,
                message: `Failed to fetch user groups: ${error.message}`
            });
        } finally {
            release();
            logger.info('Mutex released for getUserGroups');
        }
    });
};
