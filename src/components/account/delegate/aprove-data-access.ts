import { TOKEN_PROGRAM_ID, createApproveInstruction } from "@solana/spl-token";
import { Connection, PublicKey, Transaction, SendOptions, Commitment, TransactionSignature, Signer } from "@solana/web3.js";
import { detectAccountOwnerProgram } from "./detect-token-program";
import { toBigIntAmount } from "./utils";

export type AtasWithAmount = {
  ata: string;
  mint: string;
  amountRawStr: string;
  amountUi: number;
}

export type ApproveResult = {
  txid: TransactionSignature;
  approvals: {
    ownerAta: string;
    mint: string;
    programId: string;
    amount: string
  }[];
}

/**
 * approveTokenAllowances
 * - connection: RPC connection
 * - ownerPublicKey: PublicKey del propietario de las ATAs (firma requerida)
 * - signTransaction: función para firmar la transacción (wallet.signTransaction)
 * - cexDelegateAddress: PublicKey que recibirá la allowance (delegate)
 * - atasWithAmount: lista de ATAs + cantidad a aprobar
 * - confirmation: Commitment o SendOptions
 *
 * Retorna lista de txids (si agrupas todas las instrucciones en una tx -> una txid).
 *
 * Nota: por simplicidad aquí agrupo todas las approvals en una sola transacción.
 * Si tu wallet no permite firmas para muchas instrucciones o la transacción crece
 * demasiado, debes dividir en varios TX.
 *
 * Ahora retorna Promise<ApproveResult> con:
 * - txid: TransactionSignature
 * - approvals: lista de { ata, mint, programId } usados en la transacción
 */
export async function approveTokenAllowances (params: {
  connection: Connection;
  ownerPublicKey: PublicKey;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  cexDelegateAddress: PublicKey;
  atasWithAmount: AtasWithAmount[];
  confirmation?: SendOptions | Commitment;
}): Promise<ApproveResult> {
  const {
    connection,
    ownerPublicKey,
    signTransaction,
    cexDelegateAddress,
    atasWithAmount,
    confirmation,
  } = params;

  if (!atasWithAmount || atasWithAmount.length === 0) {
    throw new Error("atasWithAmount is empty");
  }

  const commitment = (typeof confirmation === "string" ? (confirmation as Commitment) : undefined) ?? undefined;

  const tx = new Transaction();

  tx.feePayer = ownerPublicKey;

  // Guardar metadata de approvals para retornar
  const approvals: { ownerAta: string; mint: string; programId: string, amount: string }[] = [];

  // Para cada ATA: detectamos ownerProgram y añadimos la instrucción approve correspondiente
  for (const entry of atasWithAmount) {
    const ataPub = typeof entry.ata === "string" ? new PublicKey(entry.ata) : entry.ata;
    const amountBigInt = toBigIntAmount(entry.amountRawStr);

    // Detectar owner program de la cuenta (puede ser Token o Token-2022 u otro)
    const progInfo = await detectAccountOwnerProgram(connection, ataPub, commitment);

    // crear approve instruction indicando explícitamente el programId detectado
    let programId: PublicKey;
    try {
      programId = new PublicKey(progInfo.ownerProgramId);
    } catch (err) {
      // fallback a TOKEN_PROGRAM_ID si algo raro sucede
      console.log('error desde approveTokenAllowances', err?.message ?? err);
      programId = TOKEN_PROGRAM_ID;
    }

    const approveIx = createApproveInstruction(
      ataPub,
      cexDelegateAddress,
      ownerPublicKey,
      amountBigInt,
      [] as Signer[],
      programId
    );

    tx.add(approveIx);

    approvals.push({
      ownerAta: ataPub.toBase58(),
      mint: entry.mint,
      programId: programId.toBase58(),
      amount: entry.amountRawStr
    });
  }

  // obtener blockhash reciente y setear en tx
  const latest = await connection.getLatestBlockhash(
    typeof confirmation === "string" ? (confirmation as Commitment) : undefined
  );
  tx.recentBlockhash = latest.blockhash;

  // firmar por el wallet
  const signedTx = await signTransaction(tx);

  // enviar raw transaction
  const raw = signedTx.serialize();
  const txid = await connection.sendRawTransaction(raw, typeof confirmation === "object" ? confirmation : undefined);

  const confirmationResult = await connection.confirmTransaction(
    {
      signature: txid,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight
    },
    'confirmed'
  );


  if (confirmationResult.value.err) {
    throw new Error(`Transaction failed: ${confirmationResult.value.err}`);
  }

  return { txid, approvals };
}
