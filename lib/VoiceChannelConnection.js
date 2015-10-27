"use strict";

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var WebSocket = require("ws");
var dns = require("dns");

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
		});
	};

	return VoiceChannelConnection;
})();

module.exports = VoiceChannelConnection;