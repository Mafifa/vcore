import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Connection, PublicKey, Commitment } from "@solana/web3.js";

export type DetectProgramInfo = {
  address: string;
  ownerProgramId: string; // base58
  ownerAlias: "Token" | "Token-2022" | "Other";
  dataLength: number;
  isExecutable: boolean;
};

/**
 * detectAccountOwnerProgram
 * - connection: Connection
 * - address: PublicKey | string -> la cuenta a inspeccionar (puede ser ATA o mint)
 *
 * Devuelve información sobre el program owner de la cuenta. En particular, el
 * field ownerProgramId que podrás pasar como `programId` a createApproveInstruction.
 */
export async function detectAccountOwnerProgram (
  connection: Connection,
  address: PublicKey | string,
  commitment?: Commitment
): Promise<DetectProgramInfo> {
  const pubkey = typeof address === "string" ? new PublicKey(address) : address;
  const accountInfo = await connection.getAccountInfo(pubkey, commitment);
  if (!accountInfo) {
    throw new Error(`Cuenta no encontrada: ${pubkey.toBase58()}`);
  }

  const owner = accountInfo.owner;
  const ownerBase58 = owner.toBase58();

  // Detección simple de alias
  let ownerAlias: DetectProgramInfo["ownerAlias"] = "Other";
  if (owner.equals(TOKEN_PROGRAM_ID)) ownerAlias = "Token";
  else if (owner.equals(TOKEN_2022_PROGRAM_ID)) ownerAlias = "Token-2022";

  return {
    address: pubkey.toBase58(),
    ownerProgramId: ownerBase58,
    ownerAlias,
    dataLength: accountInfo.data.length,
    isExecutable: accountInfo.executable,
  };
}