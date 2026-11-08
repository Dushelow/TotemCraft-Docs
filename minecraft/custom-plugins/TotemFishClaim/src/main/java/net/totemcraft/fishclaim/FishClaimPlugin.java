package net.totemcraft.fishclaim;

import org.bukkit.plugin.java.JavaPlugin;

public class FishClaimPlugin extends JavaPlugin {

    private String fishBotUrl;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        fishBotUrl = getConfig().getString("fishbot-url", "http://127.0.0.1:7842");

        ClaimCommand claimCmd = new ClaimCommand(this);
        getCommand("claim").setExecutor(claimCmd);
        getCommand("fclaim").setExecutor(claimCmd);

        FishTopCommand topCmd = new FishTopCommand(this);
        getCommand("fishtop").setExecutor(topCmd);
        getCommand("ftop").setExecutor(topCmd);

        FishCheckCommand checkCmd = new FishCheckCommand(this);
        getCommand("fishcheck").setExecutor(checkCmd);
        getCommand("fcheck").setExecutor(checkCmd);
        getCommand("fc").setExecutor(checkCmd);

        FishTransferCommand transferCmd = new FishTransferCommand(this);
        getCommand("fishtransfer").setExecutor(transferCmd);
        getCommand("ftransfer").setExecutor(transferCmd);
        getCommand("ft").setExecutor(transferCmd);

        getCommand("ftconfirm").setExecutor(new FishTransferConfirmCommand(this));
        getCommand("ftcancel").setExecutor(new FishTransferCancelCommand(this));

        FishTransferAcceptCommand acceptCmd = new FishTransferAcceptCommand(this);
        getCommand("ftaccept").setExecutor(acceptCmd);

        FishTransferDeclineCommand declineCmd = new FishTransferDeclineCommand(this);
        getCommand("ftdecline").setExecutor(declineCmd);

        FishConvertCommand convertCmd = new FishConvertCommand(this);
        getCommand("fconvert").setExecutor(convertCmd);

        FishStatsCommand statsCmd = new FishStatsCommand(this);
        getCommand("fishstats").setExecutor(statsCmd);
        getCommand("fstats").setExecutor(statsCmd);

        FishWhereCommand whereCmd = new FishWhereCommand(this);
        getCommand("fwhere").setExecutor(whereCmd);

        FishHelpCommand helpCmd = new FishHelpCommand(this);
        getCommand("fishelp").setExecutor(helpCmd);
        getCommand("fhelp").setExecutor(helpCmd);

        getServer().getPluginManager().registerEvents(new FishCatchListener(this), this);

        getLogger().info("FishClaim запущен! Бот: " + fishBotUrl);
    }

    @Override
    public void onDisable() {
        getLogger().info("FishClaim остановлен.");
    }

    public String getFishBotUrl() {
        return fishBotUrl;
    }
}
