import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetProducerPreferencesQueryKey,
  getListArrangerModelsQueryKey,
  getListPairwiseCriticsQueryKey,
  getListPersonalArrangementProfilesQueryKey,
  getListPreferenceEventsQueryKey,
  useActivatePersonalArrangementProfile,
  useDeactivatePersonalArrangementProfile,
  useDerivePersonalArrangementProfile,
  useErasePreferenceEvents,
  useGetProducerPreferences,
  useListArrangerModels,
  useListPairwiseCritics,
  useListPersonalArrangementProfiles,
  useListPreferenceEvents,
  usePromoteArrangerModel,
  usePromotePairwiseCritic,
  useRetireArrangerModel,
  useRetirePairwiseCritic,
  useTrainArrangerModel,
  useTrainPairwiseCritic,
  useUpdateProducerPreferences,
  type PairwiseCriticTrainResult,
} from "@workspace/api-client-react";
import { Brain, Loader2, Scale, Sparkles, Trash2, UserCog } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

const percent = (value: number) => `${Math.round(value * 100)} %`;
const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * Wave 7 in the studio (PR-35): the learning system was API-only. The owner
 * can now see what the platform has learned from them, control consent, erase
 * their memory, and train / promote / retire the three learned artefacts —
 * each gated exactly as the API gates it (a model that did not prove itself
 * cannot be promoted from here either).
 */
export function LearningPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const preferences = useGetProducerPreferences();
  const events = useListPreferenceEvents();
  const critics = useListPairwiseCritics();
  const profiles = useListPersonalArrangementProfiles();
  const models = useListArrangerModels();
  const refresh = (...keys: ReadonlyArray<readonly unknown[]>) => Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
  const fail = (title: string) => (error: unknown) => toast({ title, description: (error as { message?: string })?.message ?? "Unknown error", variant: "destructive" });

  const updatePreferences = useUpdateProducerPreferences({ mutation: { onSuccess: () => void refresh(getGetProducerPreferencesQueryKey()), onError: fail("Could not update learning controls") } });
  const [eraseArmed, setEraseArmed] = useState(false);
  const erase = useErasePreferenceEvents({ mutation: { onSuccess: (result) => { setEraseArmed(false); toast({ title: "Memory erased", description: `${result.erased} preference event(s) removed.` }); void refresh(getListPreferenceEventsQueryKey()); }, onError: fail("Could not erase") } });

  const [criticOutcome, setCriticOutcome] = useState<PairwiseCriticTrainResult | null>(null);
  const trainCritic = useTrainPairwiseCritic({ mutation: { onSuccess: (result) => { setCriticOutcome(result); void refresh(getListPairwiseCriticsQueryKey()); }, onError: fail("Critic training failed") } });
  const promoteCritic = usePromotePairwiseCritic({ mutation: { onSuccess: () => void refresh(getListPairwiseCriticsQueryKey()), onError: fail("Promotion refused") } });
  const retireCritic = useRetirePairwiseCritic({ mutation: { onSuccess: () => void refresh(getListPairwiseCriticsQueryKey()), onError: fail("Could not retire") } });

  const derive = useDerivePersonalArrangementProfile({ mutation: { onSuccess: () => void refresh(getListPersonalArrangementProfilesQueryKey()), onError: fail("Could not derive a profile") } });
  const activate = useActivatePersonalArrangementProfile({ mutation: { onSuccess: () => void refresh(getListPersonalArrangementProfilesQueryKey()), onError: fail("Could not activate") } });
  const deactivate = useDeactivatePersonalArrangementProfile({ mutation: { onSuccess: () => void refresh(getListPersonalArrangementProfilesQueryKey()), onError: fail("Could not deactivate") } });

  const trainModel = useTrainArrangerModel({ mutation: { onSuccess: (result) => { toast({ title: `YOUR_ARRANGER_MODEL v${result.version} trained`, description: result.reason }); void refresh(getListArrangerModelsQueryKey()); }, onError: fail("Model training failed") } });
  const promoteModel = usePromoteArrangerModel({ mutation: { onSuccess: () => void refresh(getListArrangerModelsQueryKey()), onError: fail("Promotion refused") } });
  const retireModel = useRetireArrangerModel({ mutation: { onSuccess: () => void refresh(getListArrangerModelsQueryKey()), onError: fail("Could not retire") } });

  const eventCount = events.data?.length ?? 0;
  const consentOn = preferences.data?.learningEnabled ?? false;

  return (
    <Card className="shadow-sm" data-testid="learning-panel">
      <CardHeader className="border-b bg-muted/20 pb-4">
        <CardTitle className="text-lg flex items-center gap-2"><Brain className="h-5 w-5 text-primary" /> Producer memory · what the studio learns from you</CardTitle>
        <CardDescription>
          Everything here is learned only from choices you consented to, as content-free statistics, and nothing learned outranks what you say. A learned model becomes the default only after it beats the incumbent on held-out data or the benchmark.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 p-4 md:grid-cols-2">
        {/* Consent + memory */}
        <section className="space-y-3 rounded-md border p-4" data-testid="learning-consent">
          <div className="flex items-center gap-2 text-sm font-semibold"><UserCog className="h-4 w-4" /> Consent and memory</div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="learning-enabled" className="text-sm">Learn from my choices</Label>
            <Switch id="learning-enabled" checked={consentOn} disabled={preferences.isLoading || updatePreferences.isPending}
              onCheckedChange={(checked) => updatePreferences.mutate({ data: { learningEnabled: checked, inferredBehaviorEnabled: preferences.data?.inferredBehaviorEnabled ?? false } })} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="inferred-enabled" className="text-sm">Also learn from what I do, not only what I say</Label>
            <Switch id="inferred-enabled" checked={preferences.data?.inferredBehaviorEnabled ?? false} disabled={preferences.isLoading || updatePreferences.isPending || !consentOn}
              onCheckedChange={(checked) => updatePreferences.mutate({ data: { learningEnabled: consentOn, inferredBehaviorEnabled: checked } })} />
          </div>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">{eventCount} preference event{eventCount === 1 ? "" : "s"} in your memory{events.data?.length ? ` · latest ${when(events.data[0].createdAt)}` : ""}</span>
            {eraseArmed ? (
              <div className="flex gap-1">
                <Button size="sm" variant="destructive" disabled={erase.isPending} onClick={() => erase.mutate({})}>Erase all</Button>
                <Button size="sm" variant="ghost" onClick={() => setEraseArmed(false)}>Keep</Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" disabled={!eventCount} onClick={() => setEraseArmed(true)}><Trash2 className="mr-2 h-4 w-4" /> Erase memory</Button>
            )}
          </div>
        </section>

        {/* Pairwise critic */}
        <section className="space-y-3 rounded-md border p-4" data-testid="learning-critic">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold"><Scale className="h-4 w-4" /> Pairwise critic · your taste on near-ties</div>
            <Button size="sm" variant="outline" disabled={trainCritic.isPending} onClick={() => trainCritic.mutate()}>
              {trainCritic.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Train
            </Button>
          </div>
          {criticOutcome?.status === "insufficient" && <p className="text-xs text-muted-foreground">{criticOutcome.reason} ({criticOutcome.events} events, {criticOutcome.trainingPairs} training pairs)</p>}
          {!critics.data?.length ? <p className="text-xs text-muted-foreground">No critic yet. It needs enough decisive pairwise choices to beat the built-in critic on held-out pairs.</p> : critics.data.slice(0, 3).map((critic) => (
            <div key={critic.id} className="rounded-md bg-muted/20 px-3 py-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">v{critic.version}</span>
                <Badge variant={critic.status === "active" ? "default" : "outline"}>{critic.status}</Badge>
                <span className="text-muted-foreground">held-out {percent(critic.heldOutAccuracy)} vs baseline {percent(critic.baselineAccuracy)} · {critic.trainingPairs}/{critic.heldOutPairs} pairs</span>
                <span className="ml-auto flex gap-1">
                  {critic.status === "candidate" && <Button size="sm" variant="outline" disabled={!critic.promotable || promoteCritic.isPending} onClick={() => promoteCritic.mutate({ modelId: critic.id })}>Promote</Button>}
                  {critic.status === "active" && <Button size="sm" variant="ghost" disabled={retireCritic.isPending} onClick={() => retireCritic.mutate({ modelId: critic.id })}>Retire</Button>}
                </span>
              </div>
              <div className="mt-1 text-muted-foreground">{critic.promotionReason}</div>
            </div>
          ))}
        </section>

        {/* Personal defaults */}
        <section className="space-y-3 rounded-md border p-4" data-testid="learning-profile">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4" /> Personal defaults · the lowest rung of the profile</div>
            <Button size="sm" variant="outline" disabled={derive.isPending} onClick={() => derive.mutate()}>
              {derive.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Derive
            </Button>
          </div>
          {!profiles.data?.length ? <p className="text-xs text-muted-foreground">No profile yet. A dimension needs at least 5 preferred subjects that agree; anything you state always outranks it.</p> : profiles.data.slice(0, 2).map((profile) => (
            <div key={profile.id} className="rounded-md bg-muted/20 px-3 py-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">v{profile.version}</span>
                <Badge variant={profile.active ? "default" : "outline"}>{profile.active ? "active defaults" : "not active"}</Badge>
                <span className="text-muted-foreground">{profile.support.events} events · {profile.support.pairwise} pairwise · {Object.keys(profile.dimensions).length} decided · {profile.undecided.length} undecided</span>
                <span className="ml-auto">
                  {profile.active
                    ? <Button size="sm" variant="ghost" disabled={deactivate.isPending} onClick={() => deactivate.mutate({ profileId: profile.id })}>Deactivate</Button>
                    : <Button size="sm" variant="outline" disabled={activate.isPending || !Object.keys(profile.dimensions).length} onClick={() => activate.mutate({ profileId: profile.id })}>Activate</Button>}
                </span>
              </div>
              {profile.evidence.slice(0, 3).map((item) => <div key={item.dimension} className="mt-1 text-muted-foreground">{item.summary}</div>)}
              {!profile.evidence.length && profile.undecided[0] && <div className="mt-1 text-muted-foreground">{profile.undecided[0].dimension}: {profile.undecided[0].reason}</div>}
            </div>
          ))}
        </section>

        {/* YOUR_ARRANGER_MODEL */}
        <section className="space-y-3 rounded-md border p-4" data-testid="learning-model">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold"><Brain className="h-4 w-4" /> YOUR_ARRANGER_MODEL · the trained policy</div>
            <Button size="sm" variant="outline" disabled={trainModel.isPending} onClick={() => trainModel.mutate()}>
              {trainModel.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Train + benchmark
            </Button>
          </div>
          {!models.data?.length ? <p className="text-xs text-muted-foreground">No version yet. Training learns a policy from every consented choice and benchmarks it against the reference pipeline; only a version that measurably beats it may be promoted.</p> : models.data.slice(0, 3).map((model) => (
            <div key={model.id} className="rounded-md bg-muted/20 px-3 py-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">v{model.version}</span>
                <Badge variant={model.status === "active" ? "default" : "outline"}>{model.status}</Badge>
                {model.neutral && <Badge variant="secondary">neutral · identical to the reference</Badge>}
                <Badge variant={model.beatsBaseline ? "default" : "outline"} className={model.beatsBaseline ? "bg-emerald-600 hover:bg-emerald-600" : ""}>{model.beatsBaseline ? "beats baseline" : "does not beat baseline"}</Badge>
                <span className="ml-auto flex gap-1">
                  {model.status === "candidate" && <Button size="sm" variant="outline" disabled={!model.beatsBaseline || model.neutral || promoteModel.isPending} onClick={() => promoteModel.mutate({ modelId: model.id })}>Promote</Button>}
                  {model.status === "active" && <Button size="sm" variant="ghost" disabled={retireModel.isPending} onClick={() => retireModel.mutate({ modelId: model.id })}>Retire</Button>}
                </span>
              </div>
              <div className="mt-1 text-muted-foreground">{model.reason}</div>
              {model.evidence.slice(0, 2).map((line) => <div key={line} className="mt-1 text-muted-foreground">{line}</div>)}
            </div>
          ))}
        </section>
      </CardContent>
    </Card>
  );
}
