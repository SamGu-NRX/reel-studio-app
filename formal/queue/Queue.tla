------------------------------ MODULE Queue ------------------------------
EXTENDS Naturals, Sequences, FiniteSets, TLC
CONSTANTS Assignment, Variant, PayloadValues
TwoNotes == <<1, 2>>
SameProject == <<1, 1>>
ThreeNotes == <<1, 1, 2>>
Projects == {Assignment[n] : n \in DOMAIN Assignment}
Notes == DOMAIN Assignment
SeqSet(q) == {q[i] : i \in DOMAIN q}
Remove(q, n) == SelectSeq(q, LAMBDA x: x # n)
VARIABLE s

Init == s = [
  queue |-> [p \in Projects |-> <<>>],
  pending |-> {}, requested |-> {}, admitted |-> {}, persisted |-> {},
  job |-> [p \in Projects |-> 0],
  phase |-> [p \in Projects |-> "idle"],
  renderWait |-> <<>>, alive |-> {}, permit |-> 0,
  held |-> [p \in Projects |-> FALSE],
  blocked |-> [p \in Projects |-> FALSE],
  text |-> [n \in Notes |-> 0],
  count |-> [n \in Notes |-> 0], failed |-> {}, cancelled |-> {},
  mode |-> "up", badStart |-> FALSE]

Queued == UNION {SeqSet(s.queue[p]) : p \in Projects}
Committed == {n \in Notes : s.count[n] > 0}
Terminal == Committed \cup s.failed \cup s.cancelled
Active == {s.job[p] : p \in Projects} \ {0}
Waiting(n) == n \in Queued /\ n \notin Active

Submit(n) ==
  /\ s.mode = "up"
  /\ n \notin s.requested
  /\ s' = [s EXCEPT !.requested = @ \cup {n}, !.pending = @ \cup {n}]

Persist(n) ==
  /\ s.mode = "up"
  /\ n \in s.pending
  /\ n \notin s.persisted
  /\ s' = [s EXCEPT !.persisted = @ \cup {n},
       !.queue[Assignment[n]] = Append(@, n)]

Acknowledge(n) ==
  /\ s.mode = "up"
  /\ n \in s.pending
  /\ n \in s.persisted \/ Variant = "admission"
  /\ s' = [s EXCEPT !.admitted = @ \cup {n}, !.pending = @ \ {n},
       !.queue[Assignment[n]] = IF n \in s.persisted THEN @ ELSE Append(@, n)]

Edit(n) ==
  /\ s.mode = "up"
  /\ Waiting(n)
  /\ s' = [s EXCEPT !.text[n] = IF PayloadValues = 1 THEN 0 ELSE 1 - @]

Cancel(n) ==
  /\ s.mode = "up"
  /\ Waiting(n)
  /\ s' = [s EXCEPT !.queue[Assignment[n]] = Remove(@, n),
       !.cancelled = @ \cup {n}]

Reorder(p, i) ==
  /\ s.mode = "up"
  /\ i \in 1..(Len(s.queue[p]) - 1)
  /\ Waiting(s.queue[p][i]) /\ Waiting(s.queue[p][i+1])
  /\ s' = [s EXCEPT !.queue[p][i] = s.queue[p][i+1],
       !.queue[p][i+1] = s.queue[p][i]]

Start(p) ==
  /\ s.mode = "up"
  /\ s.job[p] = 0
  /\ ~s.held[p]
  /\ Len(s.queue[p]) > 0
  /\ LET n == Head(s.queue[p]) IN
       s' = [s EXCEPT !.job[p] = n, !.phase[p] = "plan",
         !.badStart = @ \/ s.blocked[p],
         !.queue[p] = IF Variant = "remove" THEN Tail(@) ELSE @]

Plan(p) ==
  /\ s.mode = "up"
  /\ s.phase[p] = "plan"
  /\ s' = [s EXCEPT !.phase[p] = "wait",
       !.renderWait = Append(@, s.job[p])]

NoRender(p) ==
  /\ s.mode = "up"
  /\ s.phase[p] = "plan"
  /\ s' = [s EXCEPT !.phase[p] = "ready"]

Acquire(p) ==
  /\ s.mode = "up"
  /\ s.phase[p] = "wait"
  /\ s.permit = 0
  /\ Head(s.renderWait) = s.job[p]
  /\ s' = [s EXCEPT !.phase[p] = "render", !.permit = s.job[p],
       !.alive = @ \cup {s.job[p]}, !.renderWait = Tail(@)]

Drain(n) ==
  /\ n \in s.alive
  /\ s' = [s EXCEPT !.alive = @ \ {n}]

Release(p) ==
  /\ s.mode = "up"
  /\ s.permit = s.job[p] /\ s.permit # 0
  /\ s.job[p] \notin s.alive
  /\ s' = [s EXCEPT !.permit = 0,
       !.phase[p] = IF @ = "render" THEN "ready" ELSE @]

Stop(p) ==
  /\ s.mode = "up"
  /\ s.job[p] # 0
  /\ s.phase[p] \notin {"stop", "fail"}
  /\ s' = [s EXCEPT !.phase[p] = "stop", !.held[p] = TRUE,
       !.blocked[p] = TRUE, !.renderWait = Remove(@, s.job[p]),
       !.permit = IF Variant = "permit" /\ @ = s.job[p] THEN 0 ELSE @]

Fail(p) ==
  /\ s.mode = "up"
  /\ s.phase[p] \in {"plan", "wait", "render", "ready"}
  /\ s' = [s EXCEPT !.phase[p] = "fail", !.held[p] = TRUE,
       !.blocked[p] = TRUE, !.failed = @ \cup {s.job[p]},
       !.renderWait = Remove(@, s.job[p])]

Commit(p) ==
  /\ s.mode = "up"
  /\ s.phase[p] = "ready"
  /\ s' = [s EXCEPT !.count[s.job[p]] = @ + 1,
       !.phase[p] = "committed"]

Settle(p) ==
  /\ s.mode = "up"
  /\ s.phase[p] \in {"committed", "stop", "fail"}
  /\ s.job[p] \notin s.alive
  /\ s.permit # s.job[p]
  /\ s' = [s EXCEPT
       !.queue[p] = IF s.phase[p] = "fail" THEN @ ELSE Remove(@, s.job[p]),
       !.cancelled = IF s.phase[p] = "stop" /\ s.job[p] \notin Committed
                    THEN @ \cup {s.job[p]} ELSE @,
       !.job[p] = 0, !.phase[p] = "idle",
       !.held[p] = IF Variant = "hold" THEN FALSE ELSE @]

Resume(p) ==
  /\ s.mode = "up"
  /\ s.held[p]
  /\ s.job[p] = 0
  /\ s' = [s EXCEPT !.held[p] = FALSE, !.blocked[p] = FALSE]

Crash ==
  /\ s.mode = "up"
  /\ s' = [s EXCEPT !.mode = "down", !.pending = {},
       !.job = [p \in Projects |-> 0],
       !.phase = [p \in Projects |-> "idle"],
       !.permit = 0, !.renderWait = <<>>,
       !.queue = [p \in Projects |-> SelectSeq(s.queue[p], LAMBDA n: n \in s.persisted)]]

Restart ==
  /\ s.mode = "down"
  /\ (s.alive = {} \/ Variant = "restart")
  /\ s' = [s EXCEPT !.mode = "up",
       !.queue = [p \in Projects |->
         IF Variant = "replay" THEN s.queue[p]
         ELSE SelectSeq(s.queue[p], LAMBDA n: n \notin Committed)],
       !.held = [p \in Projects |-> TRUE],
       !.blocked = [p \in Projects |-> TRUE]]

Work ==
  \/ \E n \in Notes: Persist(n) \/ Acknowledge(n) \/ Drain(n)
  \/ \E p \in Projects: Start(p) \/ Plan(p) \/ NoRender(p)
       \/ Acquire(p) \/ Release(p) \/ Commit(p) \/ Settle(p) \/ Resume(p)
  \/ Restart

Next ==
  \/ Work
  \/ \E n \in Notes: Submit(n) \/ Edit(n) \/ Cancel(n)
  \/ \E p \in Projects: Stop(p) \/ Fail(p)
       \/ (\E i \in 1..Len(s.queue[p]): Reorder(p, i))
  \/ Crash

Spec == Init /\ [][Next]_s
Fairness ==
  /\ WF_s(Restart)
  /\ \A n \in Notes: WF_s(Drain(n)) /\ WF_s(Persist(n)) /\ WF_s(Acknowledge(n))
  /\ \A p \in Projects:
       /\ WF_s(Resume(p)) /\ WF_s(Start(p))
       /\ WF_s(Plan(p) \/ NoRender(p)) /\ WF_s(Acquire(p))
       /\ WF_s(Release(p)) /\ WF_s(Commit(p)) /\ WF_s(Settle(p))
FairSpec == Spec /\ Fairness
CancelFailed(n) == n \in s.failed /\ Cancel(n)
ResolvedSpec == FairSpec /\ (\A n \in Notes: SF_s(CancelFailed(n)))

TypeOK ==
  /\ s.mode \in {"up", "down"}
  /\ s.job \in [Projects -> Notes \cup {0}]
  /\ s.alive \subseteq Notes
  /\ s.count \in [Notes -> Nat]
  /\ s.text \in [Notes -> 0..1]
  /\ s.admitted \subseteq s.requested
  /\ s.persisted \subseteq s.requested
  /\ \A p \in Projects:
       /\ s.queue[p] \in Seq(Notes)
       /\ Cardinality(SeqSet(s.queue[p])) = Len(s.queue[p])
       /\ \A n \in SeqSet(s.queue[p]): Assignment[n] = p
NoDoubleCommit == \A n \in Notes: s.count[n] <= 1
NoAdmittedLost == s.admitted \subseteq Queued \cup Active \cup Terminal
AdmissionBeforeAck == s.admitted \subseteq s.persisted
OneRender == Cardinality(s.alive) <= 1
OneProjectJob == \A p \in Projects:
  Cardinality({n \in Active \cup s.alive : Assignment[n] = p}) <= 1
HoldUntilResume == ~s.badStart /\ (\A p \in Projects: s.blocked[p] => s.held[p])
NoDeadlock == (s.admitted \subseteq Terminal /\ Active = {} /\ s.alive = {})
              \/ ENABLED Work
EveryAdmittedTerminates == (<>[](s.mode = "up")) =>
  (\A n \in Notes: (n \in s.admitted) ~> (n \in Terminal))
=============================================================================
