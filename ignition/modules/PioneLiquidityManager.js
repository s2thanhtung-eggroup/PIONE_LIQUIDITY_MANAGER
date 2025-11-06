// This setup uses Hardhat Ignition to manage smart contract deployments.
// Learn more about it at https://hardhat.org/ignition

const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");
require('dotenv').config();

const PIONE_TOKEN = process.env.PIONE_TOKEN || "";
const USDT_BEP20 = process.env.USDT_BEP20 || "";
const PIONE_BRIDGE = process.env.PIONE_BRIDGE || "";
const PANCAKEROUTER = process.env.PANCAKEROUTER || "";
const PINKLOCK = process.env.PINKLOCK || "";
const PIONECHAIN_ID = process.env.PIONECHAIN_ID || "";

module.exports = buildModule("PioneLiquidityManager_modules", (m) => {

  const liquidityManager = m.contract(
    "PioneLiquidityManager", 
    [
      PIONE_TOKEN,
      USDT_BEP20,
      PIONE_BRIDGE,
      PANCAKEROUTER,
      PINKLOCK,
      PIONECHAIN_ID
    ]
  );

  return { liquidityManager };
});