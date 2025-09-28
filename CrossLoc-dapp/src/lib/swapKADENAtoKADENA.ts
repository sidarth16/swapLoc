import * as Sdk from '@1inch/cross-chain-sdk'
import {
    JsonRpcProvider,
    MaxUint256,
    parseEther,
    parseUnits,
    randomBytes,
} from 'ethers'
import { RpcProvider, Contract, Account, hash, Call, getChecksumAddress,  } from 'starknet';
import { ethers } from 'ethers'

import { uint8ArrayToHex, UINT_40_MAX } from '@1inch/byte-utils'

import escrowAbi from "./abi/EscrowDst.contract_class.json" assert { type: "json" };
import erc20Abi from "./abi/ERC20.contract_class.json" assert { type: "json" };
import escrowDstAbi from "./abi/EscrowDstOther.sol/EscrowDst.json";
import escrowSrcAbi from "./abi/EscrowSrcOther.sol/EscrowSrc.json";



// import { config } from "./config";
import { Wallet } from "./wallet";
import { Resolver } from "./resolver";
import { EscrowFactory } from "./escrow-factory";


const { Address } = Sdk

const KADENA_SRC_CONFIG = {
  chainId: 5921,
  url: "https://evm-testnet.chainweb.com/chainweb/0.0/evm-testnet/chain/21/evm/rpc",
  escrowSrc: '0x05c3682c757CBeAC6A282cB7F2Cdc645003A3EaD',
  escrowDst: '0xf3873574364DF9d509F304CEbf4F15791492d505',
  resolver: '0x0D2a7a7A808975dF6e1858772C1cC0A92177D5A9',
  resolverPk: '60f64e28157c6e82187bddedf081719423a0f3c44f35d573c878bd85a4258689',
  userPk : '60f64e28157c6e82187bddedf081719423a0f3c44f35d573c878bd85a4258689',//process.env.PRIVATE_KEY_EVM_USER,
  user : '0x0D2a7a7A808975dF6e1858772C1cC0A92177D5A9',
  mockusdc : '0xEe58bf35b2937c6f2b9b41cAf1fD338C42d5D73C',
}


const KADENA_DST_CONFIG = {
  chainId: 5920,
  url: "https://evm-testnet.chainweb.com/chainweb/0.0/evm-testnet/chain/20/evm/rpc",
  escrowSrc: '0x05c3682c757CBeAC6A282cB7F2Cdc645003A3EaD',
  escrowDst: '0xf3873574364DF9d509F304CEbf4F15791492d505',
  resolver: '0x0D2a7a7A808975dF6e1858772C1cC0A92177D5A9',
  resolverPk: '60f64e28157c6e82187bddedf081719423a0f3c44f35d573c878bd85a4258689',
  userPk : '60f64e28157c6e82187bddedf081719423a0f3c44f35d573c878bd85a4258689',//process.env.PRIVATE_KEY_EVM_USER,
  mockusdc : '0xEe58bf35b2937c6f2b9b41cAf1fD338C42d5D73C'
}

function txLink(
  txHash: string,
  chain:
    | "kadena21"
    | "kadena20"
): string {
  switch (chain) {
  
    case "kadena21":
      return `https://chain-21.evm-testnet-blockscout.chainweb.com/tx/${txHash}`;
    case "kadena20":
      return `https://chain-20.evm-testnet-blockscout.chainweb.com/tx/${txHash}`;
    default:
      throw new Error(`Unsupported chain: ${chain}`);
  }
}

export class swapKADENAtoKADENA {
    private evmProvider: JsonRpcProvider
    private kadenaProvider: JsonRpcProvider

    private userWallet: Wallet
    private userSigner: ethers.Signer | null = null;
    private resolverWallet: Wallet
    private kadenaResolver: Wallet

    constructor() {

        this.evmProvider = new JsonRpcProvider(KADENA_SRC_CONFIG.url, KADENA_SRC_CONFIG.chainId)
        this.kadenaProvider = new JsonRpcProvider(KADENA_DST_CONFIG.url, KADENA_DST_CONFIG.chainId)

        this.userWallet = new Wallet(KADENA_SRC_CONFIG.userPk as string, this.evmProvider)
        this.resolverWallet = new Wallet(KADENA_SRC_CONFIG.resolverPk as string, this.evmProvider)
        this.kadenaResolver = new Wallet(KADENA_DST_CONFIG.resolverPk as string, this.kadenaProvider)
    }

    async initUserWallet() {
        // this.userSigner = await connectMetaMask();
        // console.log("✅ Connected MetaMask user:", await this.userSigner.getAddress());
        return await this.userWallet.getAddress();
    }

    async swapCrossChain(
        srcTokenAddress: string,      
        dstTokenAddress: string,      
        makingAmount: bigint,         
        takingAmount: bigint,  
        evmUserAddress: string,         
        kadenaUserAddress: string,  
    ) {
        console.log('⚡️ Swapping Tokens from Kadena_21 -> Kadena_20 [cross-chain] ')
        console.log(`\t(swapAmounts: ${makingAmount} -> ${takingAmount})`)

        // 1.  Check + Approve src tokens
        console.log("\n[KADENA_21]: Check + Approve SRC tokens to Resolver")
        await this.checkAndApproveTokens(srcTokenAddress, makingAmount)

        // 2. Generate Secret
        console.log("\n< . . . Generating Secret . . .>")
        // const secretRaw = uint8ArrayToHex(randomBytes(32));
        const raw31 = randomBytes(31); // Generate 31 random bytes
        // Felt-safe integer
        const secretFelt = BigInt("0x" + Buffer.from(raw31).toString("hex"));
        // EVM version (right-pad with 0x00 → makes it 32 bytes total)
        const secretBytes32 = "0x" + Buffer.concat([raw31, Buffer.from([0x00])]).toString("hex");

        // 2. Create Order
        console.log("\n[KADENA_21]: Creating HTLC CrossChainOrder ")
        const { order, orderArray } = await this.createCrossChainOrder(
            srcTokenAddress,
            dstTokenAddress,
            makingAmount,
            takingAmount,
            kadenaUserAddress
        )
        

        //  Pack everything in the same way Solidity would
        const abiCoder = new ethers.AbiCoder()
        const encoded = abiCoder.encode(
        [
            "bytes32",   // salt
            "address",   // maker
            // "address",   // receiver
            "address",   // src token
            // "bytes32",   // dst token
            "uint256",   // makingAmount
            "uint256",   // takingAmount
            "uint256",   // withdrawalTimeLock
            "uint256",   // publicWithdrawalTimeLock
            "uint256",   // cancellationTimeLock
            "uint256"    // publicCancellationTimeLock
        ],
        orderArray
        )

        const orderHash = ethers.keccak256(encoded)
        // console.log("📋 OrderHash (Keccak):", orderHash)
        // console.log('📝 Order created, hash::', orderHash)
         console.log('📋 Order Created:');
        console.log(`    orderHash: ${orderHash}`);
        console.log(`    makingAmount: ${makingAmount.toString()}`);
        console.log(`    takingAmount: ${takingAmount.toString()}`);
        console.log(`    srcToken: ${srcTokenAddress}`);
        console.log(`    dstToken: ${dstTokenAddress}`);
        console.log(`    srcChain: KADENA21`);
        console.log(`    dstChain: KADENA20`);


        // 5. Sign order
        console.log("\n[KADENA_21]: Sign Order and Propagate to all Relayers")
        const signature = await this.userWallet.signer.signMessage(ethers.getBytes(orderHash))
        console.log('📝 Signature:', signature)




        console.log('\n< A Relayer has accepted your Order > \n');



        

        // 6. Resolver receives order and deploys src & dst escrows
        console.log('\n[KADENA_21]: Resolver Initiates EscrowSrc ')
        let escrowSrc = new ethers.Contract(
            KADENA_SRC_CONFIG.escrowSrc,
            escrowSrcAbi.abi,
            this.resolverWallet.signer
        )
        let deployTimeSRC = BigInt((await this.evmProvider.getBlock('latest'))!.timestamp);
        let txSRC = await escrowSrc.lock(
            orderHash, //swapId
            KADENA_SRC_CONFIG.resolver, //maker
            KADENA_SRC_CONFIG.resolver, //taker
            srcTokenAddress, //token
            makingAmount, //amount
            ethers.keccak256(secretBytes32), // hashlock
            deployTimeSRC + 10n, //withdrawalTime
            deployTimeSRC + 12n, //publicWithdrawalTime
            deployTimeSRC + 400n, //cancellationTime
            deployTimeSRC + 500n, //publicCancellationTime

        )
        const recp = await txSRC.wait();
        console.log("✅ EscrowSrc deployed in tx:", txLink(txSRC.hash,"kadena21"));
        console.log(`\n[KADENA_21]: Order ${orderHash} filled for ${makingAmount} in tx ${txSRC.hash}`)



        // -------Kadena CHAIN 20-------------
        
        // init EscrowDST in Kadena Chain
        // const escrowDst = new Contract(escrowAbi.abi, KADENA_DST_CONFIG.escrowDst, this.starknetProvider);
        // await increaseTime()

        await this.checkBalAllowanceAndApproveEVM(dstTokenAddress, kadenaUserAddress, takingAmount) 
        
        // 6. Deploy EscrowDst in Kadena
        console.log(`\n[KADENA_20] : Resolver Deploy EscrowDst`)
        let escrowDst = new ethers.Contract(
            KADENA_DST_CONFIG.escrowDst,
            escrowDstAbi.abi,
            this.kadenaResolver.signer
        )

        let deployTime = BigInt((await this.kadenaProvider.getBlock('latest'))!.timestamp);

        let tx = await escrowDst.lock(
            orderHash, //swapId
            kadenaUserAddress, //maker
            KADENA_DST_CONFIG.resolver, //taker
            dstTokenAddress, //token
            takingAmount, //amount
            ethers.keccak256(secretBytes32), // hashlock
            deployTime + 10n, //withdrawalTime
            deployTime + 12n, //publicWithdrawalTime
            deployTime + 400n, //cancellationTime
        )
        const rec = await tx.wait();
        
        console.log("✅ EscrowDst init in tx:", txLink(tx.hash,"kadena20"));
        console.log(`\n[KADENA_20]`, `Created dst deposit for order ${orderHash} in tx ${tx.hash}`)


        console.log(`\n< secret-preimage shared with resolver on Dst Order filling >`);
        console.log(`(${secretBytes32})`)

        await new Promise(wait => setTimeout(wait, 7000))


        // 10. Use Secret to claim EVM Token for STRK_User from EscrowSRC
        // 9.KadenaResolver Withdraws Funds for User from EscrowDST
        console.log(`\n[KADENA_20] : `, `Withdraw & Claim Funds for User in Kadena.EscrowDst`);
        tx = await escrowSrc.claim(
            orderHash, //swapId
            secretBytes32
        )
        await tx.wait();
        console.log(`✅ Claim complete on Kadena chain20`);
        console.log(`Tx: ${txLink(tx.hash,"kadena20")}`)
        
        // 9.KadenaResolver Withdraws Funds for User from EscrowDST
        console.log(`\n[KADENA_21] : `, `Withdraw & Claim Funds for User in Kadena.EscrowDst`);
        tx = await escrowDst.claim(
            orderHash, //swapId
            secretBytes32
        )
        await tx.wait();
        console.log(`✅ Claim complete on Kadena chain21`);
        console.log(`Tx: ${txLink(tx.hash,"kadena21")}`)

        // // 10. Get Secret from Claim Logs in DST
        // let preimage;
        // if (dstWithdrawTxReceipt.isSuccess()) {
        //     const CLAIMED_SELECTOR = '0x35cc0235f835cc84da50813dc84eb10a75e24a21d74d6d86278c0f037cb7429';

        //     const events = dstWithdrawTxReceipt.value.events;
        //     const ClaimedEvent = events.find(event =>
        //         event.keys && event.keys.includes(CLAIMED_SELECTOR)
        //     );
        //     if (ClaimedEvent) {
        //         preimage = ClaimedEvent.data[2];
        //     }
        // }
        // console.log(`< secret-preimage received from logs=> Preimage: ${preimage.toString()}`);

        

        return {
            orderHash: orderHash,
            secretBytes32,
            order
        }
    }

    private async checkBalAllowanceAndApproveEVM(tokenAddress: string, evmUserAddress: string, amount: bigint) {
        console.log('\n[KADENA_20] : taker approving dst token to Resolver')
        const userWallet = new Wallet(KADENA_DST_CONFIG.userPk as string, this.kadenaProvider);
        let tokenContract = new ethers.Contract(
            tokenAddress,
            [
                'function balanceOf(address) view returns (uint256)',
                'function approve(address,uint256) returns (bool)',
                'function allowance(address,address) view returns (uint256)',
                'function transfer(address,uint256) returns (bool)',
            ],
            userWallet.signer
        )

        
        const userBalance = await tokenContract.balanceOf(evmUserAddress)
        // console.log(`User token balance: ${userBalance}`)

        if (userBalance < amount) {
            throw new Error(`Insufficient token balance! (${userBalance} < ${amount}`)
        }

        let allowance = await tokenContract.allowance(evmUserAddress, KADENA_DST_CONFIG.escrowDst);

        if (allowance < amount) {
            console.log('Approving token')
            const approveTx = await tokenContract.approve(KADENA_DST_CONFIG.escrowDst, MaxUint256);
            const receipt = await approveTx.wait();
            console.log('✅ token Approved')
        }
        allowance = await tokenContract.allowance(evmUserAddress, KADENA_DST_CONFIG.escrowDst)
        console.log("Resolver allowance:", allowance.toString())
    }

    private async createCrossChainOrder(
        srcTokenAddress: string,
        dstTokenAddress: string,
        makingAmount: bigint,
        takingAmount: bigint,
        starknetUserAddress: string,
    ) {
        let salt = ethers.hexlify(randomBytes(32))
        let now = BigInt((await this.evmProvider.getBlock('latest'))!.timestamp);
        let withdrawalTimeLock =  now+10n;
        let publicWithdrawalTimeLock =  now+12n;
        let cancellationTimeLock =  now+400n;
        let publicCancellationTimeLock =  now+500n;
        const order = {
            salt: salt,
            maker: KADENA_SRC_CONFIG.user,
            receiver: ethers.ZeroAddress.toString(),
            maker_asset: srcTokenAddress,
            taker_asset: ethers.ZeroAddress.toString(),
            making_amount: makingAmount,
            taking_amount: takingAmount,
            withdrawal_timelock: withdrawalTimeLock,
            public_withdrawal_timelock: publicWithdrawalTimeLock,
            cancellation_timelock: cancellationTimeLock,
            public_cancellation_timelock: publicCancellationTimeLock,
        }

        const orderArray = [
            salt,
            KADENA_SRC_CONFIG.user,   //maker
            // ethers.ZeroAddress.toString(), //receiver
            srcTokenAddress, 
            // ethers.ZeroAddress.toString(),
            makingAmount,
            takingAmount,
            withdrawalTimeLock,
            publicWithdrawalTimeLock,
            cancellationTimeLock,
            publicCancellationTimeLock
        ]
        return { order, orderArray }

    }


    private async checkAndApproveTokens(tokenAddress: string, amount: bigint) {
        const tokenContract = new ethers.Contract(
            tokenAddress,
            ['function balanceOf(address) view returns (uint256)','function approve(address,uint256) returns (bool)', 'function allowance(address,address) view returns (uint256)'],
            this.userWallet.signer
        )

        const userAddress = await this.userWallet.getAddress()

        
        const userBalance = await tokenContract.balanceOf(userAddress)

        if (userBalance < amount) {
            throw new Error(`Insufficient token balance! (${userBalance} < ${amount}`)
        }

        let allowance = await tokenContract.allowance(this.userWallet.getAddress(), KADENA_SRC_CONFIG.escrowSrc);

        if (allowance < amount) {
                    console.log('Approving token to resolver')
                    const approveTx = await tokenContract.approve(KADENA_SRC_CONFIG.escrowSrc, MaxUint256);
                    const receipt = await approveTx.wait();
                    console.log('✅ token Approved')
                }
                allowance = await tokenContract.allowance(this.userWallet.getAddress(), KADENA_SRC_CONFIG.escrowSrc)
                console.log("Resolver allowance:", allowance.toString())
    }

}
