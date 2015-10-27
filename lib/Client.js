//discord.js modules
"use strict";

var _createClass = (function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; })();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var Endpoints = require("./Endpoints.js");
var User = require("./user.js");
var Server = require("./server.js");
var Channel = require("./channel.js"),
    VoiceChannel = require("./VoiceChannel.js");
var Message = require("./message.js");
var Invite = require("./invite.js");
var PMChannel = require("./PMChannel.js");
var ServerPermissions = require("./ServerPermissions.js");
var gameMap = require("../ref/gameMap.json");

// optional dependencies:
var zlib, lame, opus, wav;

//node modules
var request = require("superagent");
var WebSocket = require("ws");
var fs = require("fs");

var defaultOptions = {
	queue: false
};

var Client = (function () {
	function Client() {
		var options = arguments.length <= 0 || arguments[0] === undefined ? defaultOptions : arguments[0];
		var token = arguments.length <= 1 || arguments[1] === undefined ? undefined : arguments[1];

		_classCallCheck(this, Client);

		/*
  	When created, if a token is specified the Client will
  	try connecting with it. If the token is incorrect, no
  	further efforts will be made to connect.
  */
		this.options = options;
		// options.compress
		// options.audio

		if (this.options.audio) {
			lame = require("lame");
			opus = require("node-opus");
			wav = require("wav");
		}
		if (this.options.compress) {
			// only require zlib if necessary
			zlib = require("zlib");
		}

		this.token = token;
		this.state = 0;
		this.websocket = null;
		this.events = {};
		this.user = null;
		this.alreadySentData = false;
		this.serverCreateListener = {};
		this.typingIntervals = {};
		this.email = "abc";
		this.password = "abc";
		this.voiceChannels = {};

		/*
  	State values:
  	0 - idle
  	1 - logging in
  	2 - logged in
  	3 - ready
  	4 - disconnected
  */

		this.userCache = [];
		this.channelCache = [];
		this.serverCache = [];
		this.pmChannelCache = [];
		this.readyTime = null;
		this.checkingQueue = {};
		this.userTypingListener = {};
		this.queue = {};
		this.guildRoleCreateIgnoreList = {};
		this.__idleTime = null;
		this.__gameId = null;
	}

	Client.prototype.sendPacket = function sendPacket(JSONObject) {
		if (this.websocket.readyState === 1) {
			this.websocket.send(JSON.stringify(JSONObject));
		}
	};

	//def debug

	Client.prototype.debug = function debug(message) {
		this.trigger("debug", message);
	};

	Client.prototype.on = function on(event, fn) {
		this.events[event] = fn;
	};

	Client.prototype.off = function off(event) {
		this.events[event] = null;
	};

	Client.prototype.keepAlive = function keepAlive() {
		this.debug("keep alive triggered");
		this.sendPacket({
			op: 1,
			d: Date.now()
		});
	};

	//def trigger

	Client.prototype.trigger = function trigger(event) {
		var args = [];
		for (var arg in arguments) {
			args.push(arguments[arg]);
		}
		var evt = this.events[event];
		if (evt) {
			evt.apply(this, args.slice(1));
		}
	};

	//def login

	Client.prototype.login = function login() {
		var email = arguments.length <= 0 || arguments[0] === undefined ? "foo@bar.com" : arguments[0];
		var password = arguments.length <= 1 || arguments[1] === undefined ? "pass1234" : arguments[1];
		var callback = arguments.length <= 2 || arguments[2] === undefined ? function (err, token) {} : arguments[2];

		var self = this;

		return new Promise(function (resolve, reject) {
			if (self.state === 0 || self.state === 4) {

				self.state = 1; //set the state to logging in

				self.email = email;
				self.password = password;

				request.post(Endpoints.LOGIN).send({
					email: email,
					password: password
				}).end(function (err, res) {

					if (err) {
						self.state = 4; //set state to disconnected
						self.trigger("disconnected");
						if (self.websocket) {
							self.websocket.close();
						}
						callback(err);
						reject(err);
					} else {
						self.state = 2; //set state to logged in (not yet ready)
						self.token = res.body.token; //set our token

						self.getGateway().then(function (url) {
							self.createws(url);
							callback(null, self.token);
							resolve(self.token);
						})["catch"](function (err) {
							callback(err);
							reject(err);
						});
					}
				});
			} else {
				reject(new Error("Client already logging in or ready"));
			}
		});
	};

	Client.prototype.banMember = function banMember(user, server) {
		var daysToDeleteMessage = arguments.length <= 2 || arguments[2] === undefined ? 1 : arguments[2];
		var cb = arguments.length <= 3 || arguments[3] === undefined ? function (err) {} : arguments[3];

		var self = this;

		return new Promise(function (resolve, reject) {

			var serverID = self.resolveServerID(server);
			var memberID = self.resolveUserID(user);

			request.put(Endpoints.SERVERS + "/" + serverID + "/bans/" + memberID + "?delete-message-days=" + daysToDeleteMessage).set("authorization", self.token).end(function (err, res) {
				cb(err);
				if (err) {
					reject(err);
				} else {
					resolve();
				}
			});
		});
	};

	Client.prototype.logout = function logout() {
		var callback = arguments.length <= 0 || arguments[0] === undefined ? function (err) {} : arguments[0];

		var self = this;

		return new Promise(function (resolve, reject) {

			request.post(Endpoints.LOGOUT).set("authorization", self.token).end(function (err, res) {

				if (err) {
					callback(err);
					reject(err);
				} else {
					self.websocket.close();
					self.state = 4;
					callback();
					resolve();
				}
			});
		});
	};

	Client.prototype.createServer = function createServer(name, region) {
		var callback = arguments.length <= 2 || arguments[2] === undefined ? function (err, server) {} : arguments[2];

		var self = this;
		return new Promise(function (resolve, reject) {

			request.post(Endpoints.SERVERS).set("authorization", self.token).send({
				name: name,
				region: region
			}).end(function (err, res) {
				if (err) {
					callback(err);
					reject(err);
				} else {
					// potentially redundant in future
					// creating here does NOT give us the channels of the server
					// so we must wait for the guild_create event.
					self.serverCreateListener[res.body.id] = [resolve, callback];
					/*var srv = self.addServer(res.body);
     callback(null, srv);
     resolve(srv);*/
				}
			});
		});
	};

	Client.prototype.createChannel = function createChannel(server, channelName, channelType) {
		var callback = arguments.length <= 3 || arguments[3] === undefined ? function (err, chann) {} : arguments[3];

		var self = this;

		return new Promise(function (resolve, reject) {

			request.post(Endpoints.SERVERS + "/" + self.resolveServerID(server) + "/channels").set("authorization", self.token).send({
				name: channelName,
				type: channelType
			}).end(function (err, res) {

				if (err) {
					callback(err);
					reject(err);
				} else {
					var server = self.getServer("id", res.body.guild_id);
					var chann = self.addChannel(res.body, res.body.guild_id);
					server.addChannel(chann);
					callback(null, chann);
					resolve(chann);
				}
			});
		});
	};

	Client.prototype.leaveServer = function leaveServer(server) {
		var callback = arguments.length <= 1 || arguments[1] === undefined ? function (err, server) {} : arguments[1];

		var self = this;

		return new Promise(function (resolve, reject) {

			request.del(Endpoints.SERVERS + "/" + self.resolveServerID(server)).set("authorization", self.token).end(function (err, res) {

				if (err) {
					callback(err);
					reject(err);
				} else {
					self.serverCache.splice(self.serverCache.indexOf(server), 1);
					callback(null);
					resolve();
				}
			});
		});
	};

	Client.prototype.createInvite = function createInvite(serverOrChannel, options) {
		var callback = arguments.length <= 2 || arguments[2] === undefined ? function (err, invite) {} : arguments[2];

		var self = this;

		return new Promise(function (resolve, reject) {

			var destination;

			if (serverOrChannel instanceof Server) {
				destination = serverOrChannel.id;
			} else if (serverOrChannel instanceof Channel) {
				destination = serverOrChannel.id;
			} else {
				destination = serverOrChannel;
			}

			options = options || {};
			options.max_age = options.maxAge || 0;
			options.max_uses = options.maxUses || 0;
			options.temporary = options.temporary || false;
			options.xkcdpass = options.xkcd || false;

			request.post(Endpoints.CHANNELS + "/" + destination + "/invites").set("authorization", self.token).send(options).end(function (err, res) {
				if (err) {
					callback(err);
					reject(err);
				} else {
					var inv = new Invite(res.body, self);
					callback(null, inv);
					resolve(inv);
				}
			});
		});
	};

	Client.prototype.startPM = function startPM(user) {

		var self = this;

		return new Promise(function (resolve, reject) {
			var userId = user;
			if (user instanceof User) {
				userId = user.id;
			}
			request.post(Endpoints.USERS + "/" + self.user.id + "/channels").set("authorization", self.token).send({
				recipient_id: userId
			}).end(function (err, res) {
				if (err) {
					reject(err);
				} else {
					resolve(self.addPMChannel(res.body));
				}
			});
		});
	};

	Client.prototype.reply = function reply(destination, message, tts) {
		var callback = arguments.length <= 3 || arguments[3] === undefined ? function (err, msg) {} : arguments[3];

		var self = this;

		return new Promise(function (response, reject) {

			if (typeof tts === "function") {
				// tts is a function, which means the developer wants this to be the callback
				callback = tts;
				tts = false;
			}

			var user = destination.sender;
			self.sendMessage(destination, message, tts, callback, user + ", ").then(response)["catch"](reject);
		});
	};

	Client.prototype.deleteMessage = function deleteMessage(message, timeout) {
		var callback = arguments.length <= 2 || arguments[2] === undefined ? function (err, msg) {} : arguments[2];

		var self = this;

		return new Promise(function (resolve, reject) {
			if (timeout) {
				setTimeout(remove, timeout);
			} else {
				remove();
			}

			function remove() {
				request.del(Endpoints.CHANNELS + "/" + message.channel.id + "/messages/" + message.id).set("authorization", self.token).end(function (err, res) {
					if (err) {
						bad();
					} else {
						good();
					}
				});
			}

			function good() {
				callback();
				resolve();
			}

			function bad(err) {
				callback(err);
				reject(err);
			}
		});
	};

	Client.prototype.updateMessage = function updateMessage(message, content) {
		var callback = arguments.length <= 2 || arguments[2] === undefined ? function (err, msg) {} : arguments[2];

		var self = this;

		var prom = new Promise(function (resolve, reject) {

			content = content instanceof Array ? content.join("\n") : content;

			if (self.options.queue) {
				if (!self.queue[message.channel.id]) {
					self.queue[message.channel.id] = [];
				}
				self.queue[message.channel.id].push({
					action: "updateMessage",
					message: message,
					content: content,
					then: good,
					error: bad
				});

				self.checkQueue(message.channel.id);
			} else {
				self._updateMessage(message, content).then(good)["catch"](bad);
			}

			function good(msg) {
				prom.message = msg;
				callback(null, msg);
				resolve(msg);
			}

			function bad(error) {
				prom.error = error;
				callback(error);
				reject(error);
			}
		});

		return prom;
	};

	Client.prototype.setUsername = function setUsername(newName) {
		var callback = arguments.length <= 1 || arguments[1] === undefined ? function (err) {} : arguments[1];

		var self = this;

		return new Promise(function (resolve, reject) {
			request.patch(Endpoints.API + "/users/@me").set("authorization", self.token).send({
				avatar: self.user.avatar,
				email: self.email,
				new_password: null,
				password: self.password,
				username: newName
			}).end(function (err) {
				callback(err);
				if (err) reject(err);else resolve();
			});
		});
	};

	Client.prototype.getChannelLogs = function getChannelLogs(channel) {
		var amount = arguments.length <= 1 || arguments[1] === undefined ? 500 : arguments[1];
		var callback = arguments.length <= 2 || arguments[2] === undefined ? function (err, logs) {} : arguments[2];

		var self = this;

		return new Promise(function (resolve, reject) {

			var channelID = channel;
			if (channel instanceof Channel) {
				channelID = channel.id;
			}

			request.get(Endpoints.CHANNELS + "/" + channelID + "/messages?limit=" + amount).set("authorization", self.token).end(function (err, res) {

				if (err) {
					callback(err);
					reject(err);
				} else {
					var logs = [];

					var channel = self.getChannel("id", channelID);

					for (var _iterator = res.body, _isArray = Array.isArray(_iterator), _i = 0, _iterator = _isArray ? _iterator : _iterator[Symbol.iterator]();;) {
						var _ref;

						if (_isArray) {
							if (_i >= _iterator.length) break;
							_ref = _iterator[_i++];
						} else {
							_i = _iterator.next();
							if (_i.done) break;
							_ref = _i.value;
						}

						var message = _ref;

						var mentions = [];
						for (var _iterator2 = message.mentions, _isArray2 = Array.isArray(_iterator2), _i2 = 0, _iterator2 = _isArray2 ? _iterator2 : _iterator2[Symbol.iterator]();;) {
							var _ref2;

							if (_isArray2) {
								if (_i2 >= _iterator2.length) break;
								_ref2 = _iterator2[_i2++];
							} else {
								_i2 = _iterator2.next();
								if (_i2.done) break;
								_ref2 = _i2.value;
							}

							var mention = _ref2;

							var user = self.addUser(mention);
							if (channel.server) mentions.push(channel.server.getMember("id", user.id) || user);else mentions.push(user);
						}

						var authorRaw = self.addUser(message.author),
						    author;
						if (channel.server) author = channel.server.getMember("id", authorRaw.id) || authorRaw;else author = authorRaw;

						logs.push(new Message(message, channel, mentions, author));
					}
					callback(null, logs);
					resolve(logs);
				}
			});
		});
	};

	Client.prototype.deleteChannel = function deleteChannel(channel) {
		var callback = arguments.length <= 1 || arguments[1] === undefined ? function (err) {} : arguments[1];

		var self = this;

		return new Promise(function (resolve, reject) {

			var channelID = channel;
			if (channel instanceof Channel) {
				channelID = channel.id;
			}

			request.del(Endpoints.CHANNELS + "/" + channelID).set("authorization", self.token).end(function (err) {
				if (err) {
					callback(err);
					reject(err);
				} else {
					callback(null);
					resolve();
				}
			});
		});
	};

	Client.prototype.joinServer = function joinServer(invite) {
		var callback = arguments.length <= 1 || arguments[1] === undefined ? function (err, server) {} : arguments[1];

		var self = this;

		return new Promise(function (resolve, reject) {

			var id = invite instanceof Invite ? invite.code : invite;

			request.post(Endpoints.API + "/invite/" + id).set("authorization", self.token).end(function (err, res) {
				if (err) {
					callback(err);
					reject(err);
				} else {
					if (self.getServer("id", res.body.guild.id)) {
						resolve(self.getServer("id", res.body.guild.id));
					} else {
						self.serverCreateListener[res.body.guild.id] = [resolve, callback];
					}
				}
			});
		});
	};

	Client.prototype.setAvatar = function setAvatar(resource) {
		var callback = arguments.length <= 1 || arguments[1] === undefined ? function (err) {} : arguments[1];

		var self = this;

		return new Promise(function (resolve, reject) {
			if (resource instanceof Buffer) {
				resource = resource.toString("base64");
				resource = "data:image/jpg;base64," + resource;
			}

			request.patch(Endpoints.API + "/users/@me").set("authorization", self.token).send({
				avatar: resource,
				email: self.email,
				new_password: null,
				password: self.password,
				username: self.user.username
			}).end(function (err) {
				callback(err);
				if (err) reject(err);else resolve();
			});
		});
	};

	Client.prototype.sendFile = function sendFile(destination, file) {
		var fileName = arguments.length <= 2 || arguments[2] === undefined ? "image.png" : arguments[2];
		var callback = arguments.length <= 3 || arguments[3] === undefined ? function (err, msg) {} : arguments[3];

		var self = this;

		var prom = new Promise(function (resolve, reject) {

			var fstream;

			if (typeof file === "string" || file instanceof String) {
				fstream = fs.createReadStream(file);
				fileName = file;
			} else {
				fstream = file;
			}

			self.resolveDestination(destination).then(send)["catch"](bad);

			function send(destination) {
				if (self.options.queue) {
					//queue send file too
					if (!self.queue[destination]) {
						self.queue[destination] = [];
					}

					self.queue[destination].push({
						action: "sendFile",
						attachment: fstream,
						attachmentName: fileName,
						then: good,
						error: bad
					});

					self.checkQueue(destination);
				} else {
					//not queue
					self._sendFile(destination, fstream, fileName).then(good)["catch"](bad);
				}
			}

			function good(msg) {
				prom.message = msg;
				callback(null, msg);
				resolve(msg);
			}

			function bad(err) {
				prom.error = err;
				callback(err);
				reject(err);
			}
		});

		return prom;
	};

	Client.prototype.sendMessage = function sendMessage(destination, message, tts) {
		var callback = arguments.length <= 3 || arguments[3] === undefined ? function (err, msg) {} : arguments[3];
		var premessage = arguments.length <= 4 || arguments[4] === undefined ? "" : arguments[4];

		var self = this;

		var prom = new Promise(function (resolve, reject) {

			if (typeof tts === "function") {
				// tts is a function, which means the developer wants this to be the callback
				callback = tts;
				tts = false;
			}

			message = premessage + resolveMessage(message);
			var mentions = resolveMentions();
			self.resolveDestination(destination).then(send)["catch"](error);

			function error(err) {
				callback(err);
				reject(err);
			}

			function send(destination) {
				if (self.options.queue) {
					//we're QUEUEING messages, so sending them sequentially based on servers.
					if (!self.queue[destination]) {
						self.queue[destination] = [];
					}

					self.queue[destination].push({
						action: "sendMessage",
						content: message,
						mentions: mentions,
						tts: !!tts, //incase it's not a boolean
						then: mgood,
						error: mbad
					});

					self.checkQueue(destination);
				} else {
					self._sendMessage(destination, message, tts, mentions).then(mgood)["catch"](mbad);
				}
			}

			function mgood(msg) {
				prom.message = msg;
				callback(null, msg);
				resolve(msg);
			}

			function mbad(error) {
				prom.error = error;
				callback(error);
				reject(error);
			}

			function resolveMessage() {
				var msg = message;
				if (message instanceof Array) {
					msg = message.join("\n");
				}
				return msg;
			}

			function resolveMentions() {
				var _mentions = [];
				for (var _iterator3 = message.match(/<@[^>]*>/g) || [], _isArray3 = Array.isArray(_iterator3), _i3 = 0, _iterator3 = _isArray3 ? _iterator3 : _iterator3[Symbol.iterator]();;) {
					var _ref3;

					if (_isArray3) {
						if (_i3 >= _iterator3.length) break;
						_ref3 = _iterator3[_i3++];
					} else {
						_i3 = _iterator3.next();
						if (_i3.done) break;
						_ref3 = _i3.value;
					}

					var mention = _ref3;

					_mentions.push(mention.substring(2, mention.length - 1));
				}
				return _mentions;
			}
		});

		return prom;
	};

	Client.prototype.createRoleIfNotExists = function createRoleIfNotExists(dest, data) {
		var cb = arguments.length <= 2 || arguments[2] === undefined ? function (err, role) {} : arguments[2];

		var self = this;

		return new Promise(function (resolve, reject) {

			var serverID = self.resolveServerID(dest);
			var server = self.getServer("id", serverID);

			var baseRole = new ServerPermissions({}, server);
			for (var key in data) {
				baseRole[key] = data[key];
			}

			for (var _iterator4 = server.roles, _isArray4 = Array.isArray(_iterator4), _i4 = 0, _iterator4 = _isArray4 ? _iterator4 : _iterator4[Symbol.iterator]();;) {
				var _ref4;

				if (_isArray4) {
					if (_i4 >= _iterator4.length) break;
					_ref4 = _iterator4[_i4++];
				} else {
					_i4 = _iterator4.next();
					if (_i4.done) break;
					_ref4 = _i4.value;
				}

				var role = _ref4;

				if (baseRole.name == role.name && baseRole.packed == role.packed && baseRole.color == role.color) {
					resolve(role);
					cb(null, role);
					return false;
				}
			}

			self.createRole(dest, data).then(function (role) {
				cb(null, role);
				resolve(role);
			})["catch"](function (e) {
				cb(e);
				reject(e);
			});
		});
	};

	Client.prototype.createRole = function createRole(dest, data) {
		var cb = arguments.length <= 2 || arguments[2] === undefined ? function (err, role) {} : arguments[2];

		var self = this;

		return new Promise(function (resolve, reject) {

			var ddest = self.resolveServerID(dest);
			var server = self.getServer("id", ddest);

			request.post(Endpoints.SERVERS + "/" + ddest + "/roles").set("authorization", self.token).end(function (err, res) {

				if (err) {
					cb(err);
					reject(err);
				} else {

					var moddedPerm = new ServerPermissions(res.body, server);

					for (var key in data) {
						moddedPerm[key] = data[key];
					}

					var perms = server.addRole(res.body);
					self.guildRoleCreateIgnoreList[res.body.id] = function () {
						self.updateRole(server, moddedPerm).then(function (perm) {
							cb(null, perm);
							resolve(perm);
						})["catch"](function (err) {
							cb(err);
							reject(err);
						});
					};
				}
			});
		});
	};

	Client.prototype.updateRole = function updateRole(server, role) {
		var cb = arguments.length <= 2 || arguments[2] === undefined ? function (err, perm) {} : arguments[2];

		var self = this;

		return new Promise(function (resolve, reject) {

			server = self.resolveServerID(server);

			request.patch(Endpoints.SERVERS + "/" + server + "/roles/" + role.id).set("authorization", self.token).send({
				color: role.color,
				hoist: role.hoist,
				name: role.name,
				permissions: role.packed
			}).end(function (err, res) {
				if (err) {
					cb(err);
					reject(err);
				} else {

					var data = self.getServer("id", server).updateRole(res.body);
					resolve(data);
					cb(null, data);
				}
			});
		});
	};

	Client.prototype.deleteRole = function deleteRole(role) {
		var callback = arguments.length <= 1 || arguments[1] === undefined ? function (err) {} : arguments[1];

		// role is a ServerPermissions
		var self = this;

		return new Promise(function (resolve, reject) {

			request.del(Endpoints.SERVERS + "/" + role.server.id + "/roles/" + role.id).set("authorization", self.token).end(function (err) {
				if (err) {
					reject(err);
					callback(err);
				} else {
					resolve();
					callback();
				}
			});
		});
	};

	Client.prototype.addMemberToRole = function addMemberToRole(member, role) {
		var callback = arguments.length <= 2 || arguments[2] === undefined ? function (err) {} : arguments[2];

		var self = this;

		return new Promise(function (resolve, reject) {
			try {
				var serverId = self.resolveServerID(member.server);
				var memberId = self.resolveUserID(member);

				var acServer = self.getServer("id", serverId);
				var acMember = acServer.getMember("id", memberId);

				if (acMember.rawRoles.indexOf(role.id) !== -1) {
					// user already has role
					return;
				}

				request.patch("https://discordapp.com/api/guilds/" + serverId + "/members/" + memberId).set("authorization", self.token).send({
					roles: acMember.rawRoles.concat(role.id)
				}).end(function (err) {
					if (err) {
						reject(err);
						callback(err);
					} else {
						acMember.addRole(role);
						resolve();
						callback();
					}
				});
			} catch (e) {
				reject(e);
			}
		});
	};

	Client.prototype.removeMemberFromRole = function removeMemberFromRole(member, role) {
		var callback = arguments.length <= 2 || arguments[2] === undefined ? function (err) {} : arguments[2];

		var self = this;

		return new Promise(function (resolve, reject) {
			try {
				var serverId = self.resolveServerID(member.server);
				var memberId = self.resolveUserID(member);

				var acServer = self.getServer("id", serverId);
				var acMember = acServer.getMember("id", memberId);

				if (~acMember.rawRoles.indexOf(role.id)) {
					acMember.removeRole(role);
				}

				request.patch("https://discordapp.com/api/guilds/" + serverId + "/members/" + memberId).set("authorization", self.token).send({
					roles: acMember.rawRoles
				}).end(function (err) {
					if (err) {
						reject(err);
						callback(err);
					} else {
						acMember.addRole(role);
						resolve();
						callback();
					}
				});
			} catch (e) {
				reject(e);
			}
		});
	};

	Client.prototype.overwritePermissions = function overwritePermissions(channel, role, updatedStuff) {
		var callback = arguments.length <= 3 || arguments[3] === undefined ? function (err) {} : arguments[3];

		var self = this;

		return new Promise(function (resolve, reject) {

			var data;

			if (role instanceof ServerPermissions || role.type === "role") {
				data = ad(updatedStuff);
				data.id = role.id;
				data.type = "role";
			} else {

				data = ad(updatedStuff);
				data.id = role.id;
				data.type = "member";
			}
			request.put(Endpoints.CHANNELS + "/" + channel.id + "/permissions/" + role.id).set("authorization", self.token).send(data).end(function (err) {
				if (err) {
					reject(err);
					callback(err);
				} else {
					resolve();
					callback();
				}
			});
		});

		function ad(data) {
			var allow = 0,
			    disallow = 0;
			function bitit(value, position) {
				if (value) {
					allow |= 1 << position;
				} else {
					disallow |= 1 << position;
				}
			}

			for (var perm in data) {
				switch (perm) {
					case "canCreateInstantInvite":
						bitit(data[perm], 0);
						break;
					case "manageRoles":
						bitit(data[perm], 3);
						break;
					case "manageChannels":
						bitit(data[perm], 4);
						break;
					case "readMessages":
						bitit(data[perm], 10);
						break;
					case "sendMessages":
						bitit(data[perm], 11);
						break;
					case "sendTTSMessages":
						bitit(data[perm], 12);
						break;
					case "manageMessages":
						bitit(data[perm], 13);
						break;
					case "embedLinks":
						bitit(data[perm], 14);
						break;
					case "attachFiles":
						bitit(data[perm], 15);
						break;
					case "readMessageHistory":
						bitit(data[perm], 16);
						break;
					case "mentionEveryone":
						bitit(data[perm], 17);
						break;
					case "voiceConnect":
						bitit(data[perm], 20);
						break;
					case "voiceSpeak":
						bitit(data[perm], 21);
						break;
					case "voiceMuteMembers":
						bitit(data[perm], 22);
						break;
					case "voiceDeafenMembers":
						bitit(data[perm], 23);
						break;
					case "voiceMoveMembers":
						bitit(data[perm], 24);
						break;
					case "voiceUseVoiceActivation":
						bitit(data[perm], 25);
						break;
					default:
						break;
				}
			}

			return {
				allow: allow,
				deny: disallow
			};
		}
	};

	//def createws

	Client.prototype.createws = function createws(url) {
		if (this.websocket) return false;

		var self = this;

		//good to go
		this.websocket = new WebSocket(url);

		//open
		this.websocket.onopen = function () {
			self.trySendConnData(); //try connecting
		};

		//close
		this.websocket.onclose = function () {
			self.trigger("disconnected");
		};

		//message
		this.websocket.onmessage = function (e) {

			if (e.type === "Binary") {
				if (!zlib) zlib = require("zlib");

				e.data = zlib.inflateSync(e.data).toString();
			}

			var dat = false,
			    data = {};

			try {
				dat = JSON.parse(e.data);
				data = dat.d;
			} catch (err) {
				self.trigger("error", err, e);
				return;
			}

			self.trigger("raw", dat);

			//valid message
			switch (dat.t) {

				case "READY":
					self.debug("received ready packet");

					self.user = self.addUser(data.user);

					for (var _iterator5 = data.guilds, _isArray5 = Array.isArray(_iterator5), _i5 = 0, _iterator5 = _isArray5 ? _iterator5 : _iterator5[Symbol.iterator]();;) {
						var _ref5;

						if (_isArray5) {
							if (_i5 >= _iterator5.length) break;
							_ref5 = _iterator5[_i5++];
						} else {
							_i5 = _iterator5.next();
							if (_i5.done) break;
							_ref5 = _i5.value;
						}

						var _server = _ref5;

						var server = self.addServer(_server);
					}

					for (var _iterator6 = data.private_channels, _isArray6 = Array.isArray(_iterator6), _i6 = 0, _iterator6 = _isArray6 ? _iterator6 : _iterator6[Symbol.iterator]();;) {
						var _ref6;

						if (_isArray6) {
							if (_i6 >= _iterator6.length) break;
							_ref6 = _iterator6[_i6++];
						} else {
							_i6 = _iterator6.next();
							if (_i6.done) break;
							_ref6 = _i6.value;
						}

						var _pmc = _ref6;

						var pmc = self.addPMChannel(_pmc);
					}

					self.trigger("ready");
					self.readyTime = Date.now();
					self.debug("cached " + self.serverCache.length + " servers, " + self.channelCache.length + " channels, " + self.pmChannelCache.length + " PMs and " + self.userCache.length + " users.");
					self.state = 3;
					setInterval(function () {
						self.keepAlive.apply(self);
					}, data.heartbeat_interval);

					break;
				case "MESSAGE_CREATE":
					self.debug("received message");

					var mentions = [];
					data.mentions = data.mentions || []; //for some reason this was not defined at some point?

					var channel = self.getChannel("id", data.channel_id);
					for (var _iterator7 = data.mentions, _isArray7 = Array.isArray(_iterator7), _i7 = 0, _iterator7 = _isArray7 ? _iterator7 : _iterator7[Symbol.iterator]();;) {
						var _ref7;

						if (_isArray7) {
							if (_i7 >= _iterator7.length) break;
							_ref7 = _iterator7[_i7++];
						} else {
							_i7 = _iterator7.next();
							if (_i7.done) break;
							_ref7 = _i7.value;
						}

						var mention = _ref7;

						var user = self.addUser(mention);
						if (channel.server) mentions.push(channel.server.getMember("id", user.id) || user);else mentions.push(user);
					}

					if (channel) {
						var msg = channel.addMessage(new Message(data, channel, mentions, data.author));
						self.trigger("message", msg);
					}

					break;
				case "MESSAGE_DELETE":
					self.debug("message deleted");

					var channel = self.getChannel("id", data.channel_id);
					var message = channel.getMessage("id", data.id);
					if (message) {
						self.trigger("messageDelete", channel, message);
						channel.messages.splice(channel.messages.indexOf(message), 1);
					} else {
						//don't have the cache of that message ;(
						self.trigger("messageDelete", channel);
					}
					break;
				case "MESSAGE_UPDATE":
					self.debug("message updated");

					var channel = self.getChannel("id", data.channel_id);
					var formerMessage = channel.getMessage("id", data.id);

					if (formerMessage) {

						//new message might be partial, so we need to fill it with whatever the old message was.
						var info = {};

						for (var key in formerMessage) {
							info[key] = formerMessage[key];
						}

						for (var key in data) {
							info[key] = data[key];
						}

						data.mentions = data.mentions || [];
						var mentions = [];

						for (var _iterator8 = data.mentions, _isArray8 = Array.isArray(_iterator8), _i8 = 0, _iterator8 = _isArray8 ? _iterator8 : _iterator8[Symbol.iterator]();;) {
							var _ref8;

							if (_isArray8) {
								if (_i8 >= _iterator8.length) break;
								_ref8 = _iterator8[_i8++];
							} else {
								_i8 = _iterator8.next();
								if (_i8.done) break;
								_ref8 = _i8.value;
							}

							var mention = _ref8;

							var user = self.addUser(mention);
							if (channel.server) mentions.push(channel.server.getMember("id", user.id) || user);else mentions.push(user);
						}

						var newMessage = new Message(info, channel, mentions, formerMessage.author);

						self.trigger("messageUpdate", newMessage, formerMessage);

						channel.messages[channel.messages.indexOf(formerMessage)] = newMessage;
					}

					// message isn't in cache, and if it's a partial it could cause
					// all hell to break loose... best to just act as if nothing happened

					break;

				case "GUILD_DELETE":

					var server = self.getServer("id", data.id);

					if (server) {
						self.serverCache.splice(self.serverCache.indexOf(server), 1);
						self.trigger("serverDelete", server);
					}

					break;

				case "GUILD_BAN_ADD":

					var bannedUser = self.addUser(data.user);
					var server = self.getServer("id", data.guild_id);

					self.trigger("userBanned", bannedUser, server);

				case "CHANNEL_DELETE":

					var channel = self.getChannel("id", data.id);

					if (channel) {

						var server = channel.server;

						if (server) {

							server.channels.splice(server.channels.indexOf(channel), 1);
						}

						self.trigger("channelDelete", channel);

						self.serverCache.splice(self.serverCache.indexOf(channel), 1);
					}

					break;

				case "GUILD_CREATE":

					var server = self.getServer("id", data.id);

					if (!server) {
						//if server doesn't already exist because duh
						server = self.addServer(data);
					} /*else if(server.channels.length === 0){
       
       var srv = new Server(data, self);
       for(channel of data.channels){
       	srv.channels.push(new Channel(channel, data.id));
       }
       self.serverCache[self.serverCache.indexOf(server)] = srv;
       
       }*/

					if (self.serverCreateListener[data.id]) {
						var cbs = self.serverCreateListener[data.id];
						cbs[0](server); //promise then callback
						cbs[1](null, server); //legacy callback
						self.serverCreateListener[data.id] = null;
					}

					self.trigger("serverCreate", server);

					break;

				case "CHANNEL_CREATE":

					var channel = self.getChannel("id", data.id);

					if (!channel) {

						var chann;
						if (data.is_private) {
							chann = self.addPMChannel(data);
						} else {
							chann = self.addChannel(data, data.guild_id);
						}
						var srv = self.getServer("id", data.guild_id);
						if (srv) {
							srv.addChannel(chann);
						}
						self.trigger("channelCreate", chann);
					}

					break;

				case "GUILD_MEMBER_ADD":

					var server = self.getServer("id", data.guild_id);

					if (server) {

						var user = self.addUser(data.user); //if for whatever reason it doesn't exist..

						self.trigger("serverNewMember", server.addMember(user, data.roles), server);
					}

					break;

				case "GUILD_MEMBER_REMOVE":

					var server = self.getServer("id", data.guild_id);

					if (server) {

						var user = self.addUser(data.user); //if for whatever reason it doesn't exist..

						server.removeMember("id", user.id);

						self.trigger("serverRemoveMember", user, server);
					}

					break;

				case "GUILD_MEMBER_UPDATE":

					var user = self.addUser(data.user);
					var server = self.getServer("id", data.guild_id);
					var member = server.getMember("id", user.id);
					self.trigger("serverMemberUpdate", member, data.roles);
					server.getMember("id", user.id).rawRoles = data.roles;

					break;

				case "USER_UPDATE":

					if (self.user && data.id === self.user.id) {

						var newUser = new User(data); //not actually adding to the cache

						self.trigger("userUpdate", newUser, self.user);

						if (~self.userCache.indexOf(self.user)) {
							self.userCache[self.userCache.indexOf(self.user)] = newUser;
						}

						self.user = newUser;
					}

					break;

				case "PRESENCE_UPDATE":

					var userInCache = self.getUser("id", data.user.id);

					if (userInCache) {
						//user exists

						data.user.username = data.user.username || userInCache.username;
						data.user.id = data.user.id || userInCache.id;
						data.user.discriminator = data.user.discriminator || userInCache.discriminator;
						data.user.avatar = data.user.avatar || userInCache.avatar;

						var presenceUser = new User(data.user);
						if (presenceUser.equalsStrict(userInCache)) {
							//they're exactly the same, an actual presence update
							self.trigger("presence", {
								user: userInCache,
								oldStatus: userInCache.status,
								status: data.status,
								server: self.getServer("id", data.guild_id),
								gameId: data.game_id
							});
							userInCache.status = data.status;
							userInCache.gameId = data.game_id;
						} else {
							//one of their details changed.
							self.userCache[self.userCache.indexOf(userInCache)] = presenceUser;
							self.trigger("userUpdate", userInCache, presenceUser);
						}
					}

					break;

				case "CHANNEL_UPDATE":

					var channelInCache = self.getChannel("id", data.id),
					    serverInCache = self.getServer("id", data.guild_id);

					if (channelInCache && serverInCache) {

						var newChann;
						if (data.type === "text") newChann = new Channel(data, serverInCache);else newChann = new VoiceChannel(data, serverInCache);
						newChann.messages = channelInCache.messages;

						self.trigger("channelUpdate", channelInCache, newChann);

						self.channelCache[self.channelCache.indexOf(channelInCache)] = newChann;
					}

					break;

				case "TYPING_START":

					var userInCache = self.getUser("id", data.user_id);
					var channelInCache = self.getChannel("id", data.channel_id);

					if (!self.userTypingListener[data.user_id] || self.userTypingListener[data.user_id] === -1) {
						self.trigger("startTyping", userInCache, channelInCache);
					}

					self.userTypingListener[data.user_id] = Date.now();

					setTimeout(function () {
						if (self.userTypingListener[data.user_id] === -1) {
							return;
						}
						if (Date.now() - self.userTypingListener[data.user_id] > 6000) {
							// stopped typing
							self.trigger("stopTyping", userInCache, channelInCache);
							self.userTypingListener[data.user_id] = -1;
						}
					}, 6000);

					break;

				case "GUILD_ROLE_CREATE":

					var server = self.getServer("id", data.guild_id);
					var role = data.role;

					if (self.guildRoleCreateIgnoreList[data.role.id]) {
						server.addRole(role);
						self.guildRoleCreateIgnoreList[data.role.id]();
						self.guildRoleCreateIgnoreList[data.role.id] = null;
						break;
					}

					self.trigger("serverRoleCreate", server, server.addRole(role));

					break;

				case "GUILD_ROLE_DELETE":

					var server = self.getServer("id", data.guild_id);
					var role = server.getRole(data.role_id);

					self.trigger("serverRoleDelete", server, role);

					server.removeRole(role.id);

					break;

				case "GUILD_ROLE_UPDATE":

					var server = self.getServer("id", data.guild_id);
					var role = server.getRole(data.role.id);
					var newRole = server.updateRole(data.role);

					self.trigger("serverRoleUpdate", server, role, newRole);

					break;

				default:
					self.debug("received unknown packet");
					self.trigger("unknown", dat);
					break;

			}
		};
	};

	//def addUser

	Client.prototype.addUser = function addUser(data) {
		if (!this.getUser("id", data.id)) {
			this.userCache.push(new User(data));
		}
		return this.getUser("id", data.id);
	};

	//def addChannel

	Client.prototype.addChannel = function addChannel(data, serverId) {
		if (!this.getChannel("id", data.id)) {
			if (data.type === "text") {
				this.channelCache.push(new Channel(data, this.getServer("id", serverId)));
			} else {
				this.channelCache.push(new VoiceChannel(data, this.getServer("id", serverId)));
			}
		}
		return this.getChannel("id", data.id);
	};

	Client.prototype.addPMChannel = function addPMChannel(data) {
		if (!this.getPMChannel("id", data.id)) {
			this.pmChannelCache.push(new PMChannel(data, this));
		}
		return this.getPMChannel("id", data.id);
	};

	Client.prototype.setTopic = function setTopic(channel, topic) {
		var callback = arguments.length <= 2 || arguments[2] === undefined ? function (err) {} : arguments[2];

		var self = this;

		return new Promise(function (resolve, reject) {

			self.resolveDestination(channel).then(next)["catch"](error);

			function error(e) {
				callback(e);
				reject(e);
			}

			function next(destination) {

				var asChan = self.getChannel("id", destination);

				request.patch(Endpoints.CHANNELS + "/" + destination).set("authorization", self.token).send({
					name: asChan.name,
					position: 0,
					topic: topic
				}).end(function (err, res) {
					if (err) {
						error(err);
					} else {
						asChan.topic = res.body.topic;
						resolve();
						callback();
					}
				});
			}
		});
	};

	//def addServer

	Client.prototype.addServer = function addServer(data) {

		var self = this;
		var server = this.getServer("id", data.id);

		if (data.unavailable) {
			self.trigger("unavailable", data);
			self.debug("Server ID " + data.id + " has been marked unavailable by Discord. It was not cached.");
			return;
		}

		if (!server) {
			server = new Server(data, this);
			this.serverCache.push(server);
			if (data.channels) {
				for (var _iterator9 = data.channels, _isArray9 = Array.isArray(_iterator9), _i9 = 0, _iterator9 = _isArray9 ? _iterator9 : _iterator9[Symbol.iterator]();;) {
					var _ref9;

					if (_isArray9) {
						if (_i9 >= _iterator9.length) break;
						_ref9 = _iterator9[_i9++];
					} else {
						_i9 = _iterator9.next();
						if (_i9.done) break;
						_ref9 = _i9.value;
					}

					var channel = _ref9;

					server.channels.push(this.addChannel(channel, server.id));
				}
			}
		}

		for (var _iterator10 = data.presences, _isArray10 = Array.isArray(_iterator10), _i10 = 0, _iterator10 = _isArray10 ? _iterator10 : _iterator10[Symbol.iterator]();;) {
			var _ref10;

			if (_isArray10) {
				if (_i10 >= _iterator10.length) break;
				_ref10 = _iterator10[_i10++];
			} else {
				_i10 = _iterator10.next();
				if (_i10.done) break;
				_ref10 = _i10.value;
			}

			var presence = _ref10;

			var user = self.getUser("id", presence.user.id);
			user.status = presence.status;
			user.gameId = presence.game_id;
		}

		return server;
	};

	//def getUser

	Client.prototype.getUser = function getUser(key, value) {
		for (var _iterator11 = this.userCache, _isArray11 = Array.isArray(_iterator11), _i11 = 0, _iterator11 = _isArray11 ? _iterator11 : _iterator11[Symbol.iterator]();;) {
			var _ref11;

			if (_isArray11) {
				if (_i11 >= _iterator11.length) break;
				_ref11 = _iterator11[_i11++];
			} else {
				_i11 = _iterator11.next();
				if (_i11.done) break;
				_ref11 = _i11.value;
			}

			var user = _ref11;

			if (user[key] === value) {
				return user;
			}
		}
		return null;
	};

	//def getChannel

	Client.prototype.getChannel = function getChannel(key, value) {
		for (var _iterator12 = this.channelCache, _isArray12 = Array.isArray(_iterator12), _i12 = 0, _iterator12 = _isArray12 ? _iterator12 : _iterator12[Symbol.iterator]();;) {
			var _ref12;

			if (_isArray12) {
				if (_i12 >= _iterator12.length) break;
				_ref12 = _iterator12[_i12++];
			} else {
				_i12 = _iterator12.next();
				if (_i12.done) break;
				_ref12 = _i12.value;
			}

			var channel = _ref12;

			if (channel[key] === value) {
				return channel;
			}
		}
		return this.getPMChannel(key, value); //might be a PM
	};

	Client.prototype.getPMChannel = function getPMChannel(key, value) {
		for (var _iterator13 = this.pmChannelCache, _isArray13 = Array.isArray(_iterator13), _i13 = 0, _iterator13 = _isArray13 ? _iterator13 : _iterator13[Symbol.iterator]();;) {
			var _ref13;

			if (_isArray13) {
				if (_i13 >= _iterator13.length) break;
				_ref13 = _iterator13[_i13++];
			} else {
				_i13 = _iterator13.next();
				if (_i13.done) break;
				_ref13 = _i13.value;
			}

			var channel = _ref13;

			if (channel[key] === value) {
				return channel;
			}
		}
		return null;
	};

	//def getServer

	Client.prototype.getServer = function getServer(key, value) {
		for (var _iterator14 = this.serverCache, _isArray14 = Array.isArray(_iterator14), _i14 = 0, _iterator14 = _isArray14 ? _iterator14 : _iterator14[Symbol.iterator]();;) {
			var _ref14;

			if (_isArray14) {
				if (_i14 >= _iterator14.length) break;
				_ref14 = _iterator14[_i14++];
			} else {
				_i14 = _iterator14.next();
				if (_i14.done) break;
				_ref14 = _i14.value;
			}

			var server = _ref14;

			if (server[key] === value) {
				return server;
			}
		}
		return null;
	};

	//def trySendConnData

	Client.prototype.trySendConnData = function trySendConnData() {
		var self = this;
		if (this.token && !this.alreadySentData) {

			this.alreadySentData = true;

			var data = {
				op: 2,
				d: {
					token: this.token,
					v: 3,
					properties: {
						"$os": "discord.js",
						"$browser": "discord.js",
						"$device": "discord.js",
						"$referrer": "",
						"$referring_domain": ""
					},
					compress: self.options.compress
				}
			};
			this.websocket.send(JSON.stringify(data));
		}
	};

	Client.prototype.resolveServerID = function resolveServerID(resource) {

		if (resource instanceof Server) {
			return resource.id;
		} else {
			return resource;
		}
	};

	Client.prototype.resolveUserID = function resolveUserID(resource) {
		if (resource instanceof User) {
			// also accounts for Member
			return resource.id;
		} else {
			return resource;
		}
	};

	Client.prototype.resolveDestination = function resolveDestination(destination) {
		var channId = false;
		var self = this;

		return new Promise(function (resolve, reject) {
			if (destination instanceof Server) {
				channId = destination.id; //general is the same as server id
			} else if (destination instanceof Channel) {
					channId = destination.id;
				} else if (destination instanceof Message) {
					channId = destination.channel.id;
				} else if (destination instanceof PMChannel) {
					channId = destination.id;
				} else if (destination instanceof User) {

					//check if we have a PM
					for (var _iterator15 = self.pmChannelCache, _isArray15 = Array.isArray(_iterator15), _i15 = 0, _iterator15 = _isArray15 ? _iterator15 : _iterator15[Symbol.iterator]();;) {
						var _ref15;

						if (_isArray15) {
							if (_i15 >= _iterator15.length) break;
							_ref15 = _iterator15[_i15++];
						} else {
							_i15 = _iterator15.next();
							if (_i15.done) break;
							_ref15 = _i15.value;
						}

						var pmc = _ref15;

						if (pmc.user && pmc.user.equals(destination)) {
							resolve(pmc.id);
							return;
						}
					}

					//we don't, at this point we're late
					self.startPM(destination).then(function (pmc) {
						resolve(pmc.id);
					})["catch"](reject);
				} else {
					channId = destination;
				}
			if (channId) resolve(channId);else reject();
		});
	};

	Client.prototype._sendMessage = function _sendMessage(destination, content, tts, mentions) {

		var self = this;

		return new Promise(function (resolve, reject) {
			request.post(Endpoints.CHANNELS + "/" + destination + "/messages").set("authorization", self.token).send({
				content: content,
				mentions: mentions,
				tts: tts
			}).end(function (err, res) {

				if (err) {
					reject(err);
				} else {
					var data = res.body;

					var mentions = [];

					data.mentions = data.mentions || []; //for some reason this was not defined at some point?

					var channel = self.getChannel("id", data.channel_id);

					for (var _iterator16 = data.mentions, _isArray16 = Array.isArray(_iterator16), _i16 = 0, _iterator16 = _isArray16 ? _iterator16 : _iterator16[Symbol.iterator]();;) {
						var _ref16;

						if (_isArray16) {
							if (_i16 >= _iterator16.length) break;
							_ref16 = _iterator16[_i16++];
						} else {
							_i16 = _iterator16.next();
							if (_i16.done) break;
							_ref16 = _i16.value;
						}

						var mention = _ref16;

						var user = self.addUser(mention);
						if (channel.server) mentions.push(channel.server.getMember("id", user.id) || user);else mentions.push(user);
					}

					if (channel) {
						var msg = channel.addMessage(new Message(data, channel, mentions, { id: data.author.id }));
						resolve(msg);
					}
				}
			});
		});
	};

	Client.prototype._sendFile = function _sendFile(destination, attachment) {
		var attachmentName = arguments.length <= 2 || arguments[2] === undefined ? "DEFAULT BECAUSE YOU DIDN'T SPECIFY WHY.png" : arguments[2];

		var self = this;

		return new Promise(function (resolve, reject) {
			request.post(Endpoints.CHANNELS + "/" + destination + "/messages").set("authorization", self.token).attach("file", attachment, attachmentName).end(function (err, res) {

				if (err) {
					reject(err);
				} else {

					var chann = self.getChannel("id", destination);
					if (chann) {
						var msg = chann.addMessage(new Message(res.body, chann, [], self.user));
						resolve(msg);
					}
				}
			});
		});
	};

	Client.prototype._updateMessage = function _updateMessage(message, content) {
		var self = this;
		return new Promise(function (resolve, reject) {
			request.patch(Endpoints.CHANNELS + "/" + message.channel.id + "/messages/" + message.id).set("authorization", self.token).send({
				content: content,
				mentions: []
			}).end(function (err, res) {
				if (err) {
					reject(err);
				} else {
					var msg = new Message(res.body, message.channel, message.mentions, message.sender);
					resolve(msg);
					message.channel.messages[message.channel.messages.indexOf(message)] = msg;
				}
			});
		});
	};

	Client.prototype.getGateway = function getGateway() {
		var self = this;
		return new Promise(function (resolve, reject) {
			request.get(Endpoints.API + "/gateway").set("authorization", self.token).end(function (err, res) {
				if (err) {
					reject(err);
				} else {
					resolve(res.body.url);
				}
			});
		});
	};

	Client.prototype.setStatusIdle = function setStatusIdle() {
		this.setStatus("idle");
	};

	Client.prototype.setStatusOnline = function setStatusOnline() {
		this.setStatus("online");
	};

	Client.prototype.setStatusActive = function setStatusActive() {
		this.setStatusOnline();
	};

	Client.prototype.setStatusHere = function setStatusHere() {
		this.setStatusOnline();
	};

	Client.prototype.setStatusAway = function setStatusAway() {
		this.setStatusIdle();
	};

	Client.prototype.startTyping = function startTyping(chann, stopTypeTime) {
		var self = this;

		this.resolveDestination(chann).then(next);

		function next(channel) {
			if (self.typingIntervals[channel]) {
				return;
			}

			var fn = function fn() {
				request.post(Endpoints.CHANNELS + "/" + channel + "/typing").set("authorization", self.token).end();
			};

			fn();

			var interval = setInterval(fn, 3000);

			self.typingIntervals[channel] = interval;

			if (stopTypeTime) {
				setTimeout(function () {
					self.stopTyping(channel);
				}, stopTypeTime);
			}
		}
	};

	Client.prototype.stopTyping = function stopTyping(chann) {
		var self = this;

		this.resolveDestination(chann).then(next);

		function next(channel) {
			if (!self.typingIntervals[channel]) {
				return;
			}

			clearInterval(self.typingIntervals[channel]);

			delete self.typingIntervals[channel];
		}
	};

	Client.prototype.setStatus = function setStatus(stat) {

		var idleTime = stat === "online" ? null : Date.now();

		this.__idleTime = idleTime;

		this.websocket.send(JSON.stringify({
			op: 3,
			d: {
				idle_since: this.__idleTime,
				game_id: this.__gameId
			}
		}));
	};

	Client.prototype.setPlayingGame = function setPlayingGame(id) {

		if (id instanceof String || typeof id === "string") {

			// working on names
			var gid = id.trim().toUpperCase();

			id = null;

			for (var _iterator17 = gameMap, _isArray17 = Array.isArray(_iterator17), _i17 = 0, _iterator17 = _isArray17 ? _iterator17 : _iterator17[Symbol.iterator]();;) {
				var _ref17;

				if (_isArray17) {
					if (_i17 >= _iterator17.length) break;
					_ref17 = _iterator17[_i17++];
				} else {
					_i17 = _iterator17.next();
					if (_i17.done) break;
					_ref17 = _i17.value;
				}

				var game = _ref17;

				if (game.name.trim().toUpperCase() === gid) {

					id = game.id;
					break;
				}
			}
		}

		this.__gameId = id;

		this.websocket.send(JSON.stringify({
			op: 3,
			d: {
				idle_since: this.__idleTime,
				game_id: this.__gameId
			}
		}));
	};

	Client.prototype.playGame = function playGame(id) {
		this.setPlayingGame(id);
	};

	Client.prototype.playingGame = function playingGame(id) {

		this.setPlayingGame(id);
	};

	_createClass(Client, [{
		key: "uptime",
		get: function get() {

			return this.readyTime ? Date.now() - this.readyTime : null;
		}
	}, {
		key: "ready",
		get: function get() {
			return this.state === 3;
		}
	}, {
		key: "servers",
		get: function get() {
			return this.serverCache;
		}
	}, {
		key: "channels",
		get: function get() {
			return this.channelCache;
		}
	}, {
		key: "users",
		get: function get() {
			return this.userCache;
		}
	}, {
		key: "PMChannels",
		get: function get() {
			return this.pmChannelCache;
		}
	}, {
		key: "messages",
		get: function get() {

			var msgs = [];
			for (var _iterator18 = this.channelCache, _isArray18 = Array.isArray(_iterator18), _i18 = 0, _iterator18 = _isArray18 ? _iterator18 : _iterator18[Symbol.iterator]();;) {
				var _ref18;

				if (_isArray18) {
					if (_i18 >= _iterator18.length) break;
					_ref18 = _iterator18[_i18++];
				} else {
					_i18 = _iterator18.next();
					if (_i18.done) break;
					_ref18 = _i18.value;
				}

				var channel = _ref18;

				msgs = msgs.concat(channel.messages);
			}
			return msgs;
		}
	}]);

	return Client;
})();

module.exports = Client;