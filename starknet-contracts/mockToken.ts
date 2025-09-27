const { RpcProvider, Account, CallData, Contract, cairo, Call, Uint256 } = require("starknet");
const { default: erc20Abi } = require("../abi/ERC20.contract_class.json");
// ------------------------
// Config
// ------------------------
const PROVIDER_URL = "https://starknet-sepolia.public.blastapi.io/rpc/v0_8";//http://127.0.0.1:5050";
const provider = new RpcProvider({ nodeUrl: PROVIDER_URL});

const PRIVATE_KEY =
  "0x07f81386ae652cb222b51bc1ba251e30668aa1d13a714745ebeeebd3ef1eec5c";
const ACCOUNT_ADDRESS =
  "0x03e1d041ce0a90e16b00b47513d2fc9d63972e642439bfeb237a661d7f26ca77";

const ERC20_ADDRESS =
  "0x02c6f0cb5c7f208441fd825f2b7b30182c2803db9c94364d0d170a2f4074cba4";


// Import ABIs
import erc20Abi from "../abi/ERC20.contract_class.json" assert {
  type: "json",
};

// import erc20compiledCasm from "../target/dev/hellostark_MockERC20.compiled_contract_class.json" assert {
//   type: "json",
// };


// ------------------------
// Setup account and contracts
// ------------------------
const account = new Account(provider, ACCOUNT_ADDRESS, PRIVATE_KEY);

const erc20 = new Contract(erc20Abi.abi, ERC20_ADDRESS, provider);
erc20.connect(account);

// ------------------------
// Demo Flow
// ------------------------
async function main() {
  const myAddress = ACCOUNT_ADDRESS;
  const mintAmount = 1_000_000_000_000_000_000n;
  // const approveAmount = 500_000_000_000_000_000n;

  // Check balance - should be 20 NIT
    console.log(`Calling Starknet for account balance...`);
    const balanceInitial = await erc20.balance_of(account.address);
    console.log('account has a balance of:', balanceInitial);


    if (balanceInitial < 1n){
        console.log(`Invoke Tx - mint 1000 tokens to user...`);
        // const mintAMT: Uint256 = cairo.uint256(1000 * 10 ** 18);
        const mintCall: Call = erc20.populate(
            'mint', 
            {
                to: account.address.toString(),
                amount: 1000n * 10n ** 18n,
            }
        );
        const { transaction_hash: mintTxHash } = await account.execute(mintCall);
        // Wait for the invoke transaction to be accepted on Starknet
        console.log(`TxHash : ${mintTxHash}`);
        console.log(`Waiting for Tx to be Accepted on Starknet - Transfer...`);
        await provider.waitForTransaction(mintTxHash);
        console.log(`Tx Accepted ✅}`);
    }    

}

main().catch(console.error);
