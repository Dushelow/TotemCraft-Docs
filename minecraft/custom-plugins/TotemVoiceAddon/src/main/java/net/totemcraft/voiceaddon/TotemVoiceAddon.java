package net.totemcraft.voiceaddon;

import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.plugin.messaging.PluginMessageListener;
import su.plo.slib.api.server.entity.McServerEntity;
import su.plo.voice.api.addon.AddonInitializer;
import su.plo.voice.api.addon.AddonLoaderScope;
import su.plo.voice.api.addon.InjectPlasmoVoice;
import su.plo.voice.api.addon.annotation.Addon;
import su.plo.voice.api.server.PlasmoVoiceServer;
import su.plo.voice.api.server.audio.line.ServerSourceLine;
import su.plo.voice.api.server.audio.provider.ArrayAudioFrameProvider;
import su.plo.voice.api.server.audio.source.AudioSender;
import su.plo.voice.api.server.audio.source.ServerEntitySource;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Голос ботов TotemBots в Plasmo Voice. Бот (программа владельца) присылает свою речь по каналу totem:voice
 * обычным пакетом игры: [1] начало, [2] кусок PCM 48 кГц моно 16 бит (little-endian), [3] конец.
 * По концу фразы аддон кодирует звук в Opus средствами Plasmo Voice и проигрывает его у бота как звук от сущности:
 * игроки рядом слышат его, как обычного игрока с микрофоном. Принимается только от ников из списка bots в config.yml.
 */
@Addon(id = "totem-voice", name = "TotemVoiceAddon", version = "1.0.0", authors = {"TotemCraft"}, scope = AddonLoaderScope.SERVER)
public final class TotemVoiceAddon extends JavaPlugin implements AddonInitializer, PluginMessageListener, Listener {

    static final String CHANNEL = "totem:voice";
    private static final int MAX_BYTES = 48000 * 2 * 30;   // не больше 30 секунд на фразу

    @InjectPlasmoVoice
    private PlasmoVoiceServer voice;

    private ServerSourceLine line;
    private final Set<String> bots = new HashSet<>();
    private short distance;
    private final Map<UUID, ByteArrayOutputStream> buffers = new ConcurrentHashMap<>();
    private final Map<UUID, ServerEntitySource> sources = new ConcurrentHashMap<>();
    private final Map<UUID, AudioSender> senders = new ConcurrentHashMap<>();

    @Override
    public void onLoad() {
        PlasmoVoiceServer.getAddonsLoader().load(this);
    }

    @Override
    public void onEnable() {
        saveDefaultConfig();
        bots.clear();
        for (String n : getConfig().getStringList("bots")) bots.add(n.toLowerCase(Locale.ROOT));
        distance = (short) getConfig().getInt("distance", 24);
        getServer().getMessenger().registerIncomingPluginChannel(this, CHANNEL, this);
        getServer().getPluginManager().registerEvents(this, this);
        getLogger().info("Голос ботов: " + bots + ", слышно на " + distance + " блоков");
    }

    @Override
    public void onAddonInitialize() {
        // своя «линия» звука: у игроков в настройках Plasmo Voice появится отдельная громкость «Боты»
        line = voice.getSourceLineManager()
                .createBuilder(this, "totem_bots", "Боты", "plasmovoice:textures/icons/speaker_disc.png", 10)
                .setDefaultVolume(1.0)
                .build();
    }

    @Override
    public void onDisable() {
        senders.values().forEach(AudioSender::stop);
        sources.values().forEach(ServerEntitySource::remove);
        PlasmoVoiceServer.getAddonsLoader().unload(this);
    }

    @Override
    public void onPluginMessageReceived(String channel, Player player, byte[] message) {
        if (!CHANNEL.equals(channel) || message.length == 0) return;
        if (!bots.contains(player.getName().toLowerCase(Locale.ROOT))) return;   // только боты из списка
        UUID id = player.getUniqueId();
        switch (message[0]) {
            case 1 -> buffers.put(id, new ByteArrayOutputStream());
            case 2 -> {
                ByteArrayOutputStream b = buffers.get(id);
                if (b != null && b.size() + message.length <= MAX_BYTES) b.write(message, 1, message.length - 1);
            }
            case 3 -> {
                ByteArrayOutputStream b = buffers.remove(id);
                if (b != null && b.size() > 0) play(player, b.toByteArray());
            }
            default -> { }
        }
    }

    private void play(Player player, byte[] pcm) {
        if (line == null) return;
        short[] samples = new short[pcm.length / 2];
        ByteBuffer.wrap(pcm).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(samples);
        UUID id = player.getUniqueId();
        AudioSender old = senders.remove(id);
        if (old != null) old.stop();
        ServerEntitySource source = sources.computeIfAbsent(id, k -> {
            McServerEntity entity = voice.getMinecraftServer().getEntityByInstance(player);
            ServerEntitySource s = line.createEntitySource(entity, false);
            s.setName(player.getName());
            return s;
        });
        ArrayAudioFrameProvider frames = new ArrayAudioFrameProvider(voice, false);
        frames.addSamples(samples);   // Plasmo Voice сам режет на кадры по 20 мс и кодирует в Opus
        frames.addEnd();
        AudioSender sender = source.createAudioSender(frames, distance);
        senders.put(id, sender);
        sender.onStop(() -> { senders.remove(id, sender); frames.close(); });
        sender.start();
        int listeners = 0;
        for (Object ignored : source.getListeners(distance)) listeners++;
        if (getConfig().getBoolean("log", true)) getLogger().info(player.getName() + ": фраза " + String.format(Locale.ROOT, "%.1f", samples.length / 48000.0) + " с, слушателей с Plasmo Voice рядом: " + listeners);
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent event) {
        UUID id = event.getPlayer().getUniqueId();
        buffers.remove(id);
        AudioSender s = senders.remove(id);
        if (s != null) s.stop();
        ServerEntitySource src = sources.remove(id);
        if (src != null) src.remove();
    }
}
