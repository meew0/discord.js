var WebSocket = require("ws");
var dns = require("dns");
var udp = require("dgram");

class VoiceChannelConnection {

	constructor(voiceChannel, client) {
		this.voiceChannel = voiceChannel;
		this.client = client;

		this.websocket;
		this.server = voiceChannel.server;
		this.token;
		this.session;
		this.endpoint;
		this.connected = false;
		this.errorCallback = function(e){console.log(e.stack)};

		this.initData = {
			op: 4,
			d: {
				guild_id: this.server.id,
				channel_id: this.voiceChannel.id,
				self_mute: false,
				self_deaf: false
			}
		}

		this.client.sendPacket(this.initData);
	}

	init() {
		var self = this;

		this.endpoint = this.endpoint.replace(":80", "");

		dns.lookup(this.endpoint, function (err, address, family) {

			self.endpoint = address;
			
			// create UDP connection
			self.udp = udp.createSocket("udp4");

			self.firstPacket = true;
			self.discordIP = "";

			self.udp.bind();
			self.udp.on("message", function (msg, info) { //msg is a buffer, info is remoteAddressInfo
				
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
                    }
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
					"session_id": self.sessionID,
					"token": self.token
				}
			}

			self.websocket.send(JSON.stringify(initData));

		};

		self.websocket.onclose = function () {
			console.log("i cri");
		}

		self.websocket.onmessage = function (e) {

			var dat = JSON.parse(e.data);
			var data = dat.d;
			switch (dat.op) {

				case 2:
					/*
					{ ssrc: 1,
					port: 50276,
					modes: [ 'plain', 'xsalsa20_poly1305' ],
					heartbeat_interval: 41250 }
					*/

					self.websocketData = data;

					setInterval(function () {
						self.websocket.send(JSON.stringify({
							"op": 3,
							"d": null
						}), self.websocketData.heartbeat_interval);
					});
					
					var udpPacket = new Buffer(70);
					udpPacket.writeUIntBE(data.ssrc, 0, 4);
					self.udp.send(
						udpPacket,
						0,
						udpPacket.length,
						data.port,
						self.endpoint,
						self.errorCallback
					);
					break;

			}

		}
	}

}

module.exports = VoiceChannelConnection;