const { ethers } = require("ethers");
const dotenv = require("dotenv");

const EscrowFactoryArtifact = require("../../out/EscrowFactory.sol/EscrowFactory.json");
const ResolverArtifact = require("../../out/Resolver.sol/Resolver.json");
const ERC20Artifact = require("../../out/MockERC20.sol/MockERC20.json");

const MAINET_LOP_ADDRESS = "0x111111125421ca6dc452d289314280a0f8842a65";

const Sdk = require("@1inch/cross-chain-sdk");
const {Address} = Sdk

dotenv.config();

async function main() {
  const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY_EVM_USER, provider);
  const resolver_wallet = new ethers.Wallet(process.env.PRIVATE_KEY_EVM_RESOLVER, provider);

  const ERC20Preset = new ethers.ContractFactory(
    ERC20Artifact.abi,
    ERC20Artifact.bytecode,
    wallet
  );

  // Deploy FeeToken
  const feeToken = await ERC20Preset.deploy("FeeToken", "FEE");
  await feeToken.waitForDeployment();
  console.log("FeeToken deployed:", await feeToken.getAddress());

  // // Mint FeeToken to deployer
  // await (await feeToken.mint(wallet.address, ethers.parseUnits("1000", 18))).wait();
  // await (await feeToken.mint(resolver_wallet.address, ethers.parseUnits("1000", 18))).wait();


  // // Deploy AccessToken 
  // const accessToken = await ERC20Preset.deploy("AccessToken", "ACC");
  // await accessToken.waitForDeployment();
  // console.log("AccessToken deployed:", await accessToken.getAddress());

  // // Mint AccessToken to deployer
  // await (await accessToken.mint(wallet.address, ethers.parseUnits("1000", 18))).wait();

  // Deploy EscrowFactory
  const EscrowFactory = new ethers.ContractFactory(
    EscrowFactoryArtifact.abi,
    EscrowFactoryArtifact.bytecode,
    wallet
  );
  const factory = await EscrowFactory.deploy(
    MAINET_LOP_ADDRESS,              // limitOrderProtocol for mainet
    await feeToken.getAddress(),     // feeToken
    // Address.fromBigInt(0n).toString(),
    // await accessToken.getAddress(),  // accessToken
    Address.fromBigInt(0n).toString(), // accessToken,
    wallet.address,                  // owner
    300,                             // rescueDelaySrc
    300                              // rescueDelayDst
  );
  await factory.waitForDeployment();
  console.log("EscrowFactory deployed:", await factory.getAddress());

  // Deploy Resolver
  const Resolver = new ethers.ContractFactory(
    ResolverArtifact.abi,
    ResolverArtifact.bytecode,
    resolver_wallet
  );
  const resolver = await Resolver.deploy(
    await factory.getAddress(),   // EscrowFactory
    MAINET_LOP_ADDRESS,           // mock IOrderMixin
    resolver_wallet.address       // resolver_addr is the owner
  );
  await resolver.waitForDeployment();
  console.log("Resolver deployed:", await resolver.getAddress());
  console.log("Resolver Owner:", await resolver.owner());


  // Deploy MockUSDC
  const usdc = await ERC20Preset.deploy("USDC","usdc");
  const receipt = await usdc.deploymentTransaction().wait();
  console.log("Deployment status:", receipt.status);
  // console.log("Gas used:", receipt.gasUsed.toString());
  console.log("Contract address:", await usdc.getAddress());

  console.log("MockUSDC deployed:", await usdc.getAddress());

  // Mint 1000 USDC to user & resolver-deployer
  await (await usdc.mint(wallet.address, ethers.parseUnits("1000", 18))).wait();
  await (await usdc.mint(resolver_wallet.address, ethers.parseUnits("1000", 18))).wait();
  console.log("Minted 1000 MockUSDC to deployer");
  console.log('MockUSDC.balanceOf(',wallet.address,')', await usdc.balanceOf(wallet.address))
  console.log('MockUSDC.balanceOf(',resolver_wallet.address,')', await usdc.balanceOf(resolver_wallet.address))

}
main().catch(console.error);


// resolver owner is account w2

// anvil --fork-url https://eth-mainnet.g.alchemy.com/v2/lBsaazUwt5MNRu3XvrdH9p_Fm-PrzuiC --block-time 2
// npx ts-node script-sid/deploy-evm.ts