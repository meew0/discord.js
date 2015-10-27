var WebSocket = require("ws");

class VoiceChannelConnection{
	
	constructor(voiceChannel, client){
		this.voiceChannel = voiceChannel;
		this.client = client;
		
		this.websocket;
		this.server = voiceChannel.server;
		this.token;
		this.session;
		this.endpoint;
		
		this.initData = {
			op : 4,
			d : {
				guild_id : this.server.id,
				channel_id  : this.voiceChannel.id,
				self_mute : false,
				self_deaf : false
			}
		}
		
		this.client.sendPacket(this.initData);
	}
	
	init(token, session, endpoint){
		
	}
	
}

module.exports = VoiceChannelConnection;