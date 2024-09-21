@(requires: 'authenticated-user')
service MyService {


    action getUsersInRole(roleAdGroup : String, username : String) returns array of User;
    action getUserInfo(username : array of String)                 returns array of UserDetails;
    action getUserGroups(username : String)                        returns array of String;


    type UserDetails {
        firstName : String;
        lastName  : String;
        email     : String;
        message   : String;
        id        : String;
    }

    type User {
        id      : String;
        message : String;
    }


}
