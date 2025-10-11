import axios from "axios";
import { useState } from "react";

export default function HelloWorld(props: { msg: string }) {
  const [count, setCount] = useState(0);
  const [response, setResponse] = useState<string>("");

  const handleClick = async () => {
    try {
      const res = await axios.get("https://lttt.dev/api/url");
      setResponse(JSON.stringify(res.data));
    } catch (error) {
      setResponse("Error: " + (error as Error).message);
    }
  };

  return (
    <>
      <button onClick={handleClick}>Get API Dat a</button>
      {response && <pre className="w-[128px]">{response}</pre>}
    </>
  );
}
