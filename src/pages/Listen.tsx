import { useParams, useNavigate } from "react-router-dom";
import ListenerView from "@/components/ListenerView";

const Listen = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <ListenerView onBack={() => navigate("/")} sessionId={sessionId} />
    </div>
  );
};

export default Listen;
