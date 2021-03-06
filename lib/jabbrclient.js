var util = require('util'),
    EventEmitter = require('events').EventEmitter,
    $ = require('./utility'),
    HubConnection = require('./hubs').HubConnection,
    SignalRTransports = require('./transports'),
    httpUtils = require('./httpUtil'),
    Deferred = require('Deferred');

(function(exports) {

  var generateClientMessage = function(message) {
    return {
      id: $.newId(),
      content: message
    };
  }

  var AUTH_URL = "https://jabbr.net/api/v1/authenticate";

  var getMessageViewModel = function(chat, message) {
    var re = new RegExp("\\b@?" + chat.state.name.replace(/\./, '\\.') + "\\b", "i");
    return {
      User: message.User,
      Content: message.Content,
      Id: message.Id,
      When: message.When.fromJsonDate(),
      IsOwn: re.test(message.User.name)
    };
  };

  var JabbrClientEvents = {
    onMessageReceived: "messageReceived",
    onChangeNote: "changeNote"
  };

  exports.JabbrClientEvents = JabbrClientEvents;
  
  /**
   *
   * @param url The url of the jabbr server
   * @param options Optional options to set things such as what transport is used.
   */
  exports.JabbrClient = function(url, options) {
    var self = this
      , options = options || {}
      , transport = options.transport || "serverSentEvents";
    this.url = url;
    AUTH_URL = this.url + '/api/v1/authenticate';
    this.hub = new HubConnection(url);
    this.clientTransport = SignalRTransports[transport];
    this.log("Configured to use " + this.clientTransport.name + " transport");
    this.hub.createHubProxies();
    this.hub.proxies.chat.client = {
      addMessage: function(message, room) {
        self.emit(JabbrClientEvents.onMessageReceived, getMessageViewModel(self.hub.proxies.chat, message), room);
      },
      changeNote: function(user, room) {
        self.emit(JabbrClientEvents.onChangeNote, user, room);
      }
    };
  };

  util.inherits(exports.JabbrClient, EventEmitter);

  exports.JabbrClient.prototype.authenticate = function(username, password) {
    var self = this
      , postData = { username: username, password: password }
      , d = new Deferred();
    httpUtils.postJson(AUTH_URL, postData, function(body) {
      d.resolve(body);
    }, function(error) {
      d.reject(error);
    });
    return d.promise();
  };

  exports.JabbrClient.prototype.connect = function(username, password, onSuccess) {
    var self = this,
        options = {
          transport: self.clientTransport
        };
    
    // before we start the hub we need to authenticate...
    this.authenticate(username, password)
      .fail(function(e) {
        self.hub.log("Failed to authenticate: " + e);
      })
      .done(function(authToken) {
        self.hub.log("Authentication successful. Joining hub.");
        self.hub.setAuthToken(authToken);
        self.hub.start(options, function() {
          self.hub.proxies.chat.server.join()
              .fail(function(e) {
                self.hub.log("Failed to join hub: " + e);
              })
              .done(function(success) {
                self.hub.log("Joined hub!");
                if (onSuccess) {
                    onSuccess();
                }
              });
        });
      });

    this.hub.error(function() {
      self.hub.log("An error ocurred");
    });
  };

  /**
   * Joins a room. This room has to exist first
   *
   * @param room The room to join
   * @param onSuccess Optional callback to execute if successful
   */
  exports.JabbrClient.prototype.joinRoom = function(roomName, onSuccess) {
    var self = this,
        clientMessage = {
          id: $.newId(),
          content: "/join " + roomName,
          room: self.hub.proxies.chat.state.activeRoom
        };
    this.hub.proxies.chat.server.send(clientMessage)
      .fail(function(e) {
        self.hub.log("Failed to join room: " + e);
      })
      .done(function(success) {
        self.hub.log("Joined " + roomName);
        if (onSuccess) {
          onSuccess();
        }
      });
  };

  /**
   * Set the nick. If a nick exists and the password is correct,
   * the nick of the client will be changed. If the nick doesn't
   * exist then it will automatically be associated with the password
   * by the server.
   *
   * @param username The username to set
   * @param password The password to use
   */
  exports.JabbrClient.prototype.setNick = function(username, password) {
    var clientMessage = generateClientMessage("/nick " + username + " " + password);
    return this.hub.proxies.chat.server.send(clientMessage);
  };

  /**
   * Show a small flag which represents your nationality.
   *
   * @param isoCountry Iso 3366-2 Code (ISO Reference Chart: http://en.wikipedia.org/wiki/ISO_3166-1_alpha-2)
   */
  exports.JabbrClient.prototype.setFlag = function(isoCountry) {
    var clientMessage = generateClientMessage("/flag " + isoCountry);
    return this.hub.proxies.chat.server.send(clientMessage);
  };

  /**
   * Send a message to a room
   *
   * @param msg The message to send
   * @param room The room to send the message to
   */
  exports.JabbrClient.prototype.say = function(msg, room) {
    var clientMessage = generateClientMessage(msg);
    clientMessage.room = room;
    return this.hub.proxies.chat.server.send(clientMessage);
  };

  /**
   * Sets the gravatar
   *
   * @param email The email address to use for the gravatar
   */
  exports.JabbrClient.prototype.setGravatar = function(email) {
    var clientMessage = generateClientMessage("/gravatar " + email);
    return this.hub.proxies.chat.server.send(clientMessage);
  };

  /**
   * Sets a note that others can see
   *
   * @param note The note to set
   */
  exports.JabbrClient.prototype.setNote = function(note) {
    var clientMessage = generateClientMessage("/note " + note);
    return this.hub.proxies.chat.server.send(clientMessage);
  };

  /**
   * Leaves a room
   *
   * @param room The room to leave
   * @param callback An optional callback when leaving the room is successful
   */
  exports.JabbrClient.prototype.leaveRoom = function(room, callback) {
    var clientMessage = generateClientMessage("/leave " + room);
    clientMessage.room = room;
    this.hub.proxies.chat.server.send(clientMessage).then(function() {
      if (callback) {
        callback();
      }
    });

    exports.JabbrClient.prototype.disconnect = function() {
      this.hub.stop();
    };
  };

  /**
   * Logs to the console
   *
   * @param msg The msg to log
   */
  exports.JabbrClient.prototype.log = function(msg) {
    var m = "[" + new Date().toTimeString() + "] JabbrClient: " + msg;
    console.log(m);
  };

})(module.exports)
