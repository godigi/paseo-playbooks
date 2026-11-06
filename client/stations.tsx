import { Pressable, Text, View } from "react-native";
import { isTerminal, type Run } from "../shared/types";
import type { Theme } from "./theme";

/** The trains of a pipeline, newest first. */
export function trainsOf(pipeline: Run, runs: readonly Run[]): Run[] {
  return runs.filter((run) => run.train?.pipelineId === pipeline.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** A train's name, from its station: "Dev train". */
export function trainName(run: Run): string {
  const title = run.playbook.title;
  const cut = title.lastIndexOf(" · ");
  return `${cut === -1 ? (run.train?.station ?? title) : title.slice(cut + 3)} train`;
}

/** Jobs not ended yet, on a pipeline: "1 job", "3 jobs". */
export function openJobsLabel(pipeline: Run): string {
  const count = pipeline.jobs.filter((job) => job.status === "open").length;
  return `${count} ${count === 1 ? "job" : "jobs"}`;
}

/**
 * A singleton pipeline's stations, in `needs` order: each one's waiting list (the jobs waiting
 * there, oldest first) and its current train.
 */
export function Stations(props: { theme: Theme; pipeline: Run; runs: readonly Run[]; onOpenTrain?: (run: Run) => void }) {
  const { theme, pipeline } = props;
  const stations = pipeline.playbook.singleton?.stations ?? [];
  const trains = trainsOf(pipeline, props.runs);
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {stations.map((station, index) => {
        const waiting = pipeline.jobs
          .filter((job) => job.status === "open" && job.waiting.some((place) => place.station === station.id))
          .sort((a, b) => a.waiting.find((place) => place.station === station.id)!.since.localeCompare(b.waiting.find((place) => place.station === station.id)!.since));
        const train = trains.find((candidate) => candidate.train!.station === station.id && !isTerminal(candidate.status));
        const last = trains.find((candidate) => candidate.train!.station === station.id && isTerminal(candidate.status));
        const riding = train ? train.jobs.filter((job) => job.status === "open").length : 0;
        return (
          <View
            key={station.id}
            accessibilityLabel={`Station ${station.title}: ${waiting.length} job(s) waiting, ${train ? `train ${train.id} running with ${riding} job(s)` : "no train running"}`}
            style={{ width: 240, borderRadius: 10, borderWidth: 1, borderColor: train ? theme.colors.accent : theme.colors.border, backgroundColor: theme.colors.surface1, padding: 10, gap: 6 }}
          >
            <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>
              {index > 0 ? "→ " : ""}
              {station.title}
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "400" }}> · {station.mode}</Text>
            </Text>
            <View style={{ gap: 2 }}>
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>Waiting list</Text>
              {waiting.length === 0 ? (
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>empty</Text>
              ) : (
                waiting.map((job) => (
                  <Text key={job.id} numberOfLines={1} style={{ color: theme.colors.statusWarning, fontSize: 12 }}>
                    {job.label}
                  </Text>
                ))
              )}
            </View>
            <View style={{ gap: 2 }}>
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>Train</Text>
              {train ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Open train ${train.id}`} disabled={!props.onOpenTrain} onPress={() => props.onOpenTrain?.(train)}>
                  <Text numberOfLines={2} style={{ color: theme.colors.accent, fontSize: 12 }}>
                    {train.id.replace(/^run_/, "")} · {riding} job(s) · {train.status === "waiting_gate" ? "waiting for a human" : "running"}
                  </Text>
                </Pressable>
              ) : (
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                  none{last ? ` (last: ${last.id.replace(/^run_/, "")}, ${last.status})` : ""}
                </Text>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}
