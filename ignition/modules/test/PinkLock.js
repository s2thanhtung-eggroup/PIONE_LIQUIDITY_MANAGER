// This setup uses Hardhat Ignition to manage smart contract deployments.
// Learn more about it at https://hardhat.org/ignition

const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("PinkLock_modules", (m) => {

  const pinkLock = m.contract("PinkLock02");
    
  return { pinkLock };
});
