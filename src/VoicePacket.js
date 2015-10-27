// credit to izy521
// https://github.com/izy521/discord.io/blob/69dd61d4d6d1197167c4f5fdda7035f2071ed993/lib/index.js
// anything voice related required help from him!

module.exports = function VoicePacket(packet, sequence, timestamp, ssrc) {

	var audioBuffer = packet//packet['ref.buffer'];
	var retBuff = new Buffer(audioBuffer.length + 12);
	retBuff.fill(0);
	retBuff[0] = 0x80;
	retBuff[1] = 0x78;
	retBuff.writeUIntBE(sequence, 2, 2);
	retBuff.writeUIntBE(timestamp, 4, 4);
	retBuff.writeUIntBE(ssrc, 8, 4);

	for (var i = 0; i < audioBuffer.length; i++) {
		retBuff[i + 12] = audioBuffer[i];
	}

	return retBuff;

}