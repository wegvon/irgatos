import { useState } from "react";
import type { WebServices } from "../../model/protocol";
import { read } from "../client";
import { openSheet } from "../route";
import { Group, Spinner, plainButton } from "./parts";
import { RefreshCw } from "../../../../shared/ui/icons";

type Service = WebServices["services"][number];

const STATE_COLOR: Record<Service["state"], string> = {
  online: "bg-(--ok)",
  slow: "bg-(--warn)",
  offline: "bg-(--bad)",
};

function summary(services: Service[] | undefined) {
  if (!services) return { color: "bg-content/25", text: "Services" };
  const offline = services.filter((service) => service.state === "offline");
  const slow = services.filter((service) => service.state === "slow");
  if (offline.length)
    return { color: STATE_COLOR.offline, text: `${offline.length} offline` };
  if (slow.length)
    return { color: STATE_COLOR.slow, text: `${slow.length} slow` };
  return { color: STATE_COLOR.online, text: "All good" };
}

/** Header pill: the worst service state at a glance; tap for the list. */
export function ServicesChip({
  services,
  connected,
}: {
  services: Service[] | undefined;
  connected: boolean;
}) {
  const { color, text } = connected
    ? summary(services)
    : { color: STATE_COLOR.offline, text: "Mac offline" };
  return (
    <button
      onClick={() => openSheet({ name: "services" })}
      className="web-press inline-flex h-8 items-center gap-2 rounded-full bg-(--surface) px-3 text-[13px] font-medium text-content/75 shadow-[0_0_0_0.5px_var(--color-stroke)]"
    >
      <span className={`size-2 rounded-full ${color}`} />
      {text}
    </button>
  );
}

export function ServicesSheet({
  services,
  connected,
  onChecked,
}: {
  services: Service[] | undefined;
  connected: boolean;
  onChecked: (services: Service[]) => void;
}) {
  const [checking, setChecking] = useState(false);
  const checkNow = async () => {
    setChecking(true);
    try {
      onChecked((await read<WebServices>("services", { fresh: "1" })).services);
    } finally {
      setChecking(false);
    }
  };
  return (
    <div className="flex flex-col gap-5 px-5 pb-6">
      <div className="flex items-center gap-3 rounded-[18px] bg-(--surface) px-4 py-3.5 shadow-[0_0_0_0.5px_var(--color-stroke)]">
        <span
          className={`size-2.5 rounded-full ${connected ? STATE_COLOR.online : STATE_COLOR.offline}`}
        />
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-medium">Your Mac</div>
          <div className="text-[13px] text-content/50">
            {connected
              ? "Connected over Tailscale"
              : "Not answering. Is Irgatos open and the Mac awake?"}
          </div>
        </div>
      </div>
      <Group>
        {services?.length ? (
          services.map((service) => (
            <div key={service.id} className="flex items-center gap-3 px-4 py-3">
              <span
                className={`size-2.5 shrink-0 rounded-full ${STATE_COLOR[service.state]}`}
              />
              <div className="min-w-0 flex-1">
                <div className="text-[16px] font-medium">{service.label}</div>
                <div className="truncate font-mono text-[12px] text-content/45">
                  {service.host}
                </div>
              </div>
              <div className="shrink-0 text-right text-[13px] tabular-nums text-content/55">
                {service.state === "offline"
                  ? (service.detail ?? "Offline")
                  : service.latencyMs != null
                    ? `${service.latencyMs} ms`
                    : ""}
              </div>
            </div>
          ))
        ) : (
          <div className="px-4 py-4 text-[15px] text-content/50">
            {services ? "No services in use." : "Checking…"}
          </div>
        )}
      </Group>
      <button
        className={`${plainButton} self-center`}
        disabled={checking || !connected}
        onClick={() => void checkNow()}
      >
        {checking ? <Spinner /> : <RefreshCw className="size-4" />}
        Check now
      </button>
    </div>
  );
}
