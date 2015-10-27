"use strict";

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var WebSocket = require("ws");
var dns = require("dns");
var udp = require("dgram");
var VoicePacket = require("./VoicePacket.js");
var fs = require("fs");

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
		this.errorCallback = function (e) {};
		this.closed = function () {
			console.log("closed");
		};
		this.success = function () {
			console.log("success");

			var readstream = fs.createReadStream("C:/users/amish/desktop/audio.wav");

			this.test(readstream);
		};

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
								"mode": self.websocketData.modes[0] //Plain
							}
						}
					};
					self.websocket.send(JSON.stringify(wsDiscPayload));
					self.firstPacket = false;
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
			};

			self.websocket.send(JSON.stringify(initData));
		};

		self.websocket.onclose = function () {
			self.closed();
		};

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
						}));
					}, self.websocketData.heartbeat_interval);

					var udpPacket = new Buffer(70);
					udpPacket.writeUIntBE(data.ssrc, 0, 4);
					self.udp.send(udpPacket, 0, udpPacket.length, data.port, self.endpoint, self.errorCallback);
					break;
				case 4:
					self.connected = true;
					self.selectedMode = data.mode;
					self.success();
					break;
			}
		};
	};

	VoiceChannelConnection.prototype.sendAudio = function sendAudio(sequence, timestamp, opusEncoder, wavOutput, udpClient, vWS, speakingPacket, sPInterval) {
		var self = this;

		var buff = wavOutput.read(1920);
		if (buff && buff.length === 1920) {
			sequence + 10 < 65535 ? sequence += 1 : sequence = 0;
			timestamp + 9600 < 4294967295 ? timestamp += 960 : timestamp = 0;

			var encoded = opusEncoder.encode(buff, 1920);
			var audioPacket = VoicePacket(encoded, sequence, timestamp, self.websocket.ssrc);

			console.log(audioPacket);

			udpClient.send(audioPacket, 0, audioPacket.length, self.websocketData.port, self.endpoint, self.errorCallback);
			setTimeout(function () {
				self.sendAudio(sequence, timestamp, opusEncoder, wavOutput, udpClient, vWS, speakingPacket, sPInterval);
			}, 20);
		} else {
			speakingPacket.d.data.speaking = false;
			vWS.send(JSON.stringify(speakingPacket));
			clearInterval(sPInterval);
		}
	};

	VoiceChannelConnection.prototype.test = function test(stream) {

		var Opus = require("node-opus");
		var Wav = require("wav");
		var self = this;
		var sequence = 0;
		var timestamp = 0;

		var speakingPacket = {
			"op": 5,
			"d": {
				"speaking": true,
				"delay": 5
			}
		};

		self.websocket.send(JSON.stringify(speakingPacket));
		var sPInterval = setInterval(function () {
			self.websocket.send(JSON.stringify(speakingPacket));
		}, 5);

		var opusEncoder = new Opus.OpusEncoder(48000, 1);
		var wavReader = new Wav.Reader();

		var wavOutput = stream.pipe(wavReader);

		wavOutput.on('readable', function () {
			console.log(wavOutput);
			self.sendAudio(sequence, timestamp, opusEncoder, wavOutput, self.udp, self.websocket, speakingPacket, sPInterval);
		});
	};

	return VoiceChannelConnection;
})();

module.exports = VoiceChannelConnection;