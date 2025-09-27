// // stark.ts
import { RpcProvider, Account, Call, Contract } from "starknet";

// import escrowAbi from "../target/dev/hellostark_EscrowDst.contract_class.json" assert { type: "json" };

// // ------------------------
// // Config
// // ------------------------
// const PROVIDER_URL = "https://starknet-sepolia.public.blastapi.io/rpc/v0_8";
// const PRIVATE_KEY = "0x06165f0032ab3b175d88f7f57ad86bef6a9e2ecacf3fe0fa7988a9384c6fe529";
// const ACCOUNT_ADDRESS = "0x03cd91c0ace43f0b8cb28c970c23cf8f05d0adcf37bd9108b0ca377868242453";

// const MOCK_ERC20_ADDRESS = "0x02d7ef1afd9b4cd826d23b0e3d5949f60045846ebf84880378de777053d6ecc1";
// const ESCROW_ADDRESS = "0x05f3de42f7a270ae473ed1227b53c57dcd95c564e3f96342aed86123e2f81d32";

// // ------------------------
// // Provider & Account
// // ------------------------
// const provider = new RpcProvider({ nodeUrl: PROVIDER_URL });
// const account = new Account(provider, ACCOUNT_ADDRESS, PRIVATE_KEY);

// // ------------------------
// // Contracts
// // ------------------------
// const erc20 = new Contract(erc20Abi.abi, MOCK_ERC20_ADDRESS, provider);
// erc20.connect(account);

// const escrowDst = new Contract(escrowAbi.abi, ESCROW_ADDRESS, provider);
// escrowDst.connect(account);


// ------------------------
// Types
// ------------------------
export type OrderStrk = {
    swap_id: bigint;
    maker: string;
    taker: string;
    token: string;
    amount: bigint;
    hashlock: bigint;
    withdrawalTimeLock: number;
    publicWithdrawalTimeLock: number;
    cancellationTimeLock: number;
    publicCancellationTimeLock: number;
};


// ------------------------
// Helpers
// ------------------------
async function getBlockTimestamp(provider: RpcProvider) {
  const block = await provider.getBlock("latest");
  return block.timestamp;
}

// async function checkBalAndAllowance(provider, erc20Address, user, spender: string, amount: bigint) {
//     const erc20 = new Contract(erc20Abi.abi, erc20Address, provider);

//     // Check balance
//     const userBalance = await erc20.balance_of(user);
//     console.log(`\nMaker token balance : ${userBalance}`)
//     if (amount>userBalance){
//         throw new Error(`ERR: Insufficient token Balance (${userBalance} < amount: ${amount})` )
//         return ;
//     }

//     const allowance = await erc20.allowance(user, spender);
//     if (allowance < amount){
//         const approveCall: Call = erc20.populate("approve", {
//             spender,
//             amount,
//         });
//         const { transaction_hash } = await account.execute(approveCall);
//         await provider.waitForTransaction(transaction_hash);
//         return;
//     }
// }

async function lock(
    provider: RpcProvider,
    order: OrderStrk,
    type: string,
    escrowDst: Contract,
    resolver: Account
) {
    
    if (type=='dst') {
        const lockCall: Call = escrowDst.populate("lock", {
            swap_id: order.swap_id,
            maker: order.maker,
            taker: order.taker,
            token: order.token,
            amount: order.amount,
            hashlock: order.hashlock,
            withdrawalTimeLock: order.withdrawalTimeLock,
            publicWithdrawalTimeLock: order.publicWithdrawalTimeLock,
            cancellationTimeLock: order.cancellationTimeLock
        });
        const { transaction_hash } = await resolver.execute(lockCall);
        await provider.waitForTransaction(transaction_hash);
        return transaction_hash;
    }
    else if (type=='src'){
        const lockCall: Call = escrowDst.populate("lock", {
            swap_id: order.swap_id,
            maker: order.maker,
            taker: order.taker,
            token: order.token,
            amount: order.amount,
            hashlock: order.hashlock,
            withdrawalTimeLock: order.withdrawalTimeLock,
            publicWithdrawalTimeLock: order.publicWithdrawalTimeLock,
            cancellationTimeLock: order.cancellationTimeLock,
            publicCancellationTimeLock: order.publicCancellationTimeLock
        });
        const { transaction_hash } = await resolver.execute(lockCall);
        await provider.waitForTransaction(transaction_hash);
        return transaction_hash;
    }
}

async function claim(
    provider: RpcProvider, escrowDst: Contract, swap_id: bigint, preimage: bigint , resolver: Account) {
  const claimCall: Call = escrowDst.populate("claim", {
    swap_id,
    preimage,
  });
  const { transaction_hash } = await resolver.execute(claimCall);
  await provider.waitForTransaction(transaction_hash);
  return transaction_hash;
}

// async function cancel(swap_id: bigint) {
//   const cancelCall: Call = escrowDst.populate("cancel", { swap_id });
//   const { transaction_hash } = await account.execute(cancelCall);
//   await provider.waitForTransaction(transaction_hash);
//   return transaction_hash;
// }

// ------------------------
// Export API
// ------------------------
export const stark = {
  getBlockTimestamp,
//   approve,
  lock,
  claim,
//   cancel,
};
