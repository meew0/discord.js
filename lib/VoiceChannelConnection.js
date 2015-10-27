"use strict";

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var WebSocket = require("ws");

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

	VoiceChannelConnection.prototype.init = function init(token, session, endpoint) {};

	return VoiceChannelConnection;
})();

module.exports = VoiceChannelConnection;