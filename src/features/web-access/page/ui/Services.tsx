import { useState } from "react";
import type { WebServices } from "../../model/protocol";
import { read } from "../client";
import { openSheet } from "../route";
import {
  Group,
  IconBadge,
  Pill,
  Spinner,
  TONE,
  secondaryButton,
  type Tone,
} from "./parts";
import { Monitor, RefreshCw } from "../../../../shared/ui/icons";

type Service = WebServices["services"][number];

const STATE_TONE: Record<Service["state"], Tone> = {
  online: "emerald",
  slow: "amber",
  offline: "rose",
};

const STATE_LABEL: Record<Service["state"], string> = {
  online: "Online",
  slow: "Slow",
  offline: "Offline",
};

/** The worst state at a glance. */
export function macTone(
  services: Service[] | undefined,
  connected: boolean,
): Tone {
  if (!connected || services?.some((service) => service.state === "offline"))
    return "rose";
  if (services?.some((service) => service.state === "slow")) return "amber";
  return "emerald";
}

function summary(services: Service[] | undefined, connected: boolean) {
  if (!connected) return "Mac offline";
  if (!services) return "Services";
  const offline = services.filter((service) => service.state === "offline");
  const slow = services.filter((service) => service.state === "slow");
  if (offline.length) return `${offline.length} offline`;
  if (slow.length) return `${slow.length} slow`;
  return "All good";
}

/** Header pill on the iPad: the worst service state; tap for the list. */
export function ServicesChip({
  services,
  connected,
}: {
  services: Service[] | undefined;
  connected: boolean;
}) {
  return (
    <button
      onClick={() => openSheet({ name: "services" })}
      className="web-press inline-flex h-10 items-center gap-2 rounded-full bg-content/8 px-3.5 text-[13.5px] font-semibold text-(--ink)"
    >
      <span
        className={`${TONE[macTone(services, connected)]} tone-dot size-2 rounded-full`}
      />
      {summary(services, connected)}
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
    <div className="flex flex-col gap-4 px-5 pb-6">
      <div className="glass flex items-center gap-3.5 rounded-[24px] p-4">
        <IconBadge tone={connected ? "muted" : "rose"} size="size-11">
          <Monitor className="size-5" />
        </IconBadge>
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-semibold text-(--ink)">Your Mac</div>
          <div className="text-[13px] text-(--ink-2)">
            {connected
              ? "Connected over Tailscale"
              : "Not answering. Is Irgatos open and the Mac awake?"}
          </div>
        </div>
        <Pill tone={connected ? "emerald" : "rose"}>
          {connected ? "Live" : "Offline"}
        </Pill>
      </div>
      <Group>
        {services?.length ? (
          services.map((service) => (
            <div
              key={service.id}
              className="flex items-center gap-3 px-4 py-3.5"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold text-(--ink)">
                  {service.label}
                </div>
                <div className="truncate font-mono text-[12px] text-(--ink-3)">
                  {service.host}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Pill tone={STATE_TONE[service.state]}>
                  {STATE_LABEL[service.state]}
                </Pill>
                <span className="text-[12px] font-medium tabular-nums text-(--ink-3)">
                  {service.state === "offline"
                    ? (service.detail ?? "")
                    : service.latencyMs != null
                      ? `${service.latencyMs} ms`
                      : ""}
                </span>
              </div>
            </div>
          ))
        ) : (
          <div className="px-4 py-4 text-[15px] text-(--ink-2)">
            {services ? "No services in use." : "Checking…"}
          </div>
        )}
      </Group>
      <button
        className={`${secondaryButton} self-center`}
        disabled={checking || !connected}
        onClick={() => void checkNow()}
      >
        {checking ? <Spinner /> : <RefreshCw className="size-4" />}
        Check now
      </button>
    </div>
  );
}
