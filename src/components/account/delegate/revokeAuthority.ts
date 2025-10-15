import { TOKEN_PROGRAM_ID, createRevokeInstruction } from "@solana/spl-token";
import { Connection, PublicKey, Transaction, SendOptions, Commitment, TransactionSignature, Signer } from "@solana/web3.js";
import { detectAccountOwnerProgram } from "./detect-token-program";

/**
 * revokeTokenAllowances
 * - Revoke para una lista de ATAs (agrupadas en una tx)
 */
export async function revokeTokenHandler (params: {
  connection: Connection;
  ownerPublicKey: PublicKey;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  atas: (string | PublicKey)[];
  confirmation?: SendOptions | Commitment;
}): Promise<TransactionSignature> {
  const { connection, ownerPublicKey, signTransaction, atas, confirmation } = params;

  if (!atas || atas.length === 0) {
    throw new Error("atas is empty");
  }

  const commitment =
    (typeof confirmation === "string" ? (confirmation as Commitment) : undefined) ??
    undefined;

  const tx = new Transaction();

  for (const ata of atas) {
    const ataPub = typeof ata === "string" ? new PublicKey(ata) : ata;

    // Detectar owner program de la cuenta para usar el mismo programId al crear revoke
    const progInfo = await detectAccountOwnerProgram(connection, ataPub, commitment);

    let programId: PublicKey;
    try {
      programId = new PublicKey(progInfo.ownerProgramId);
    } catch (err) {
      console.log('error desde el revoke:', err.message);

      programId = TOKEN_PROGRAM_ID;
    }

    const revokeIx = createRevokeInstruction(ataPub, ownerPublicKey, [] as Signer[], programId);
    tx.add(revokeIx);
  }

  // blockhash
  const latest = await connection.getLatestBlockhash(
    typeof confirmation === "string" ? (confirmation as Commitment) : undefined
  );
  tx.recentBlockhash = latest.blockhash;

  // firmar y enviar
  const signedTx = await signTransaction(tx);
  const raw = signedTx.serialize();
  const txid = await connection.sendRawTransaction(raw, typeof confirmation === "object" ? confirmation : undefined);

  return txid;
}