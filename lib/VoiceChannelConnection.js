"use strict";

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var WebSocket = require("ws");
var dns = require("dns");
var udp = require("dgram");

var VoiceChannelConnection = (function () {
	function VoiceChannelConnection(voiceChannel, client) {
		_classCallCheck(this, VoiceChannelConnection);

		this.voiceChannel = voiceChannel;
		this.client = client;

		this.websocket;
		this.server = voiceChannel.server;
		this.token;
		this.session;
		this.endpoint;
		this.connected = false;

		this.initData = {
			op: 4,
			d: {
				guild_id: this.server.id,
				channel_id: this.voiceChannel.id,
				self_mute: false,
				self_deaf: false
			}
		};

		this.client.sendPacket(this.initData);
	}

	VoiceChannelConnection.prototype.init = function init() {
		var self = this;

		this.endpoint = this.endpoint.replace(":80", "");

		dns.lookup(this.endpoint, function (err, address, family) {

			self.endpoint = address;

			// create UDP connection
			self.udp = udp.createSocket("udp4");

			self.firstPacket = true;
			self.discordIP = "";

			self.udp.bind();
			self.udp.on("message", function (msg, info) {
				//msg is a buffer, info is remoteAddressInfo

				var bufferArray = JSON.parse(JSON.stringify(msg)).data;

				if (self.firstPacket) {
					// this is our first packet! yay
					for (var i = 4; i < bufferArray.indexOf(0, i); i++) {
						self.discordIP += String.fromCharCode(bufferArray[i]);
					}
					self.discordPort = msg.readUIntLE(msg.length - 2, 2).toString(10);

					var wsDiscPayload = {
						"op": 1,
						"d": {
							"protocol": "udp",
							"data": {
								"address": self.discordIP,
								"port": Number(self.discordPort),
								"mode": self.websocket.modes[0] //Plain
							}
						}
					};
					self.websocket.send(JSON.stringify(wsDiscPayload));
					self.firstPacket = false;
					console.log("some shit happened yo");
				}
			});
		});

		// create websocket
		self.websocket = new WebSocket("ws://" + self.endpoint, null, { rejectUnauthorized: false });

		self.websocket.onopen = function () {

			var initData = {
				op: 0,
				d: {
					"server_id": self.server.id,
					"user_id": self.client.user.id,
					"session_id": self.session,
					"token": self.token
				}
			};

			self.websocket.send(JSON.stringify(initData));
		};
	};

	return VoiceChannelConnection;
})();

module.exports = VoiceChannelConnection;