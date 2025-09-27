// const verifyProof = async (proof) => {
//   console.log('proof', proof);
//   const response = await fetch(
//     'https://developer.world.org/api/v2/verify/app_staging_129259332fd6f93d4fabaadcc5e4ff9d',
//     {
//       method: 'POST',
//       headers: {
//         'Content-Type': 'application/json',
//       },
//       body: JSON.stringify({ ...proof, action: "test"}),
//     }
//   );
//   if (response.ok) {
//     const { verified } = await response.json();
//     return verified;
//   } else {
//     const { code, detail } = await response.json();
//     throw new Error(`Error Code ${code}: ${detail}`);
//   }
// };

"use server";

import { VerificationLevel } from "@worldcoin/idkit-core";
import { verifyCloudProof } from "@worldcoin/idkit-core/backend";

export type VerifyReply = {
  success: boolean;
  code?: string;
  attribute?: string | null;
  detail?: string;
};

interface IVerifyRequest {
  proof: {
    nullifier_hash: string;
    merkle_root: string;
    proof: string;
    verification_level: VerificationLevel;
  };
  signal?: string;
}

// const app_id = process.env.NEXT_PUBLIC_WLD_APP_ID as `app_${string}`;
// const action = process.env.NEXT_PUBLIC_WLD_ACTION as string;

const app_id = "app_staging_27e1b62f12d18f53d61837d47fab95e1" ;
const action ="test" ;

export async function verify(
  proof: IVerifyRequest["proof"],
  signal?: string
): Promise<VerifyReply> {
  const verifyRes = await verifyCloudProof(proof, app_id, action, signal);
  if (verifyRes.success) {
    return { success: true };
  } else {
    return { success: false, code: verifyRes.code, attribute: verifyRes.attribute, detail: verifyRes.detail };
  }
}