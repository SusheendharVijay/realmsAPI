import { NextPage } from "next";
import {
  PublicKey,
  Transaction,
  sendAndConfirmRawTransaction,
  Keypair,
} from "@solana/web3.js";
import { useState, useEffect } from "react";
import { getDevnetConnection, getKeypair } from "../utils/general";
import { sign } from "crypto";
type DisplayEncoding = "utf8" | "hex";
type PhantomEvent = "disconnect" | "connect" | "accountChanged";
type PhantomRequestMethod =
  | "connect"
  | "disconnect"
  | "signTransaction"
  | "signAllTransactions"
  | "signMessage";

interface ConnectOpts {
  onlyIfTrusted: boolean;
}

interface PhantomProvider {
  publicKey: PublicKey | null;
  isConnected: boolean | null;
  signTransaction: (transaction: Transaction) => Promise<Transaction>;
  signAllTransactions: (transactions: Transaction[]) => Promise<Transaction[]>;
  signAndSendTransaction: (transaction: Transaction) => Promise<string>;
  signMessage: (
    message: Uint8Array | string,
    display?: DisplayEncoding
  ) => Promise<any>;
  connect: (opts?: Partial<ConnectOpts>) => Promise<{ publicKey: PublicKey }>;
  disconnect: () => Promise<void>;
  on: (event: PhantomEvent, handler: (args: any) => void) => void;
  request: (method: PhantomRequestMethod, params: any) => Promise<unknown>;
}

const PhantomTest: NextPage = () => {
  const dave = new PublicKey("4rpZQJHMz5UNWQEutZcLJi7hGaZgV3vnFoS1EqZFJRi2");
  const connection = getDevnetConnection();
  const newAdmin = Keypair.generate();
  const [provider, setProvider] = useState<PhantomProvider | undefined>(
    undefined
  );
  const [walletKey, setWalletKey] = useState<PhantomProvider | undefined>(
    undefined
  );
  const connectWallet = async () => {
    // @ts-ignore
    const { solana } = window;

    if (solana) {
      try {
        const response = await solana.connect();
        console.log("wallet account ", response.publicKey.toString());
        setWalletKey(response.publicKey.toString());
      } catch (err) {
        // { code: 4001, message: 'User rejected the request.' }
      }
    }
  };

  const addAdmin = async () => {
    if (provider) {
      // const input = JSON.stringify({
      //   adminAuthority: LHT.publicKey,
      //   newAdmin: new PublicKey("4rpZQJHMz5UNWQEutZcLJi7hGaZgV3vnFoS1EqZFJRi3"),
      //   daoWallet: null,
      // });

      const input = JSON.stringify({
        newAdmin: "B6nau95gSNCtxMpZEYRNXScvszX7tDZkvkMNXXmwF6QD",
        proposer: "LHTsVjUDKH99XYNbvzRAEfrG836KY63sJnvHFvLuNfa",
      });

      // const response = await fetch(
      //   `http://localhost:3001/api/phantomtest/addAdmin`,
      //   {
      //     method: "POST",
      //     body: input,
      //     headers: {
      //       "Content-Type": "application/json",
      //       "Access-Control-Allow-Origin": "*",
      //     },
      //   }
      // );

      const response = await fetch(
        `http://localhost:3001/api/Treasury/addAdminProposal`,
        {
          method: "POST",
          body: input,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      const data = await response.json();
      console.log(data);

      const txns = data.serializedTxns.map((txn: any) =>
        Transaction.from(txn.data)
      );

      // const txn = Transaction.from(data.serializedTxn);
      // console.log(txn);
      // const signers = txn.signatures.map((s) => s.publicKey.toBase58());
      // console.log(signers);

      const signedTxns = await provider.signAllTransactions(txns);

      for (let signedTxn of signedTxns) {
        const sig = await sendAndConfirmRawTransaction(
          connection,
          signedTxn.serialize()
        );

        console.log(sig);
      }
    }
  };

  const getProvider = (): PhantomProvider | undefined => {
    if ("solana" in window) {
      // @ts-ignore
      const provider = window.solana as any;
      if (provider.isPhantom) return provider as PhantomProvider;
    }
  };

  useEffect(() => {
    const provider = getProvider();
    if (provider) {
      console.log(provider);
      setProvider(provider);
    } else setProvider(undefined);
  }, []);

  return (
    <div className="App">
      <header className="App-header">
        <h2>Tutorial: Connect to Phantom Wallet</h2>
        {provider && (
          <button
            onClick={connectWallet}
            style={{
              fontSize: "16px",
              padding: "15px",
              fontWeight: "bold",
              borderRadius: "5px",
            }}
          >
            Connect to Phantom Wallet
          </button>
        )}

        {!provider && (
          <p>
            No provider found. Install{" "}
            <a href="https://phantom.app/">Phantom Browser extension</a>
          </p>
        )}
        <button onClick={addAdmin}>Add admin</button>

        <p>
          Built by{" "}
          <a
            href="https://twitter.com/arealesramirez"
            target="_blank"
            rel="noreferrer"
            className="twitter-link"
          >
            @arealesramirez
          </a>
        </p>
      </header>
    </div>
  );
};

export default PhantomTest;
