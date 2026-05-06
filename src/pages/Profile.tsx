import { Layout } from '@/components/Layout';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { User, Trophy, Target, Calendar, LogOut, Pencil, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

const Profile = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [saving, setSaving] = useState(false);
  const [entriesOpen, setEntriesOpen] = useState(false);
  const [scoringOpen, setScoringOpen] = useState(false);
  const [scoringFormat, setScoringFormat] = useState<'t20' | 'test'>('t20');

  const { data: profile } = useQuery({
    queryKey: ['profile', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', user!.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: teamCount = 0 } = useQuery({
    queryKey: ['team-count', user?.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('user_teams')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user!.id);
      if (error) throw error;
      return count || 0;
    },
    enabled: !!user,
  });

  const { data: entries = [] } = useQuery({
    queryKey: ['my-entries', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_teams')
        .select(`
          id,
          total_points,
          match_id,
          matches (
            team_a,
            team_b,
            status,
            match_date
          )
        `)
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const { data: leagueCount = 0 } = useQuery({
    queryKey: ['league-count', user?.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('league_members')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user!.id);
      if (error) throw error;
      return count || 0;
    },
    enabled: !!user,
  });

  const handleEditOpen = () => {
    setNewUsername(profile?.username || '');
    setEditOpen(true);
  };

  const handleSaveUsername = async () => {
    if (!newUsername.trim() || !user) return;
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ username: newUsername.trim() })
      .eq('user_id', user.id);
    setSaving(false);
    if (error) {
      toast({ title: 'Error', description: 'Failed to update username', variant: 'destructive' });
    } else {
      toast({ title: 'Updated', description: 'Username changed successfully' });
      queryClient.invalidateQueries({ queryKey: ['profile', user.id] });
      setEditOpen(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  const statusColor = (status: string) => {
    if (status === 'live') return 'text-green-400';
    if (status === 'completed') return 'text-muted-foreground';
    return 'text-yellow-400';
  };

  const statusLabel = (status: string) => {
    if (status === 'live') return '● LIVE';
    if (status === 'completed') return 'Completed';
    return 'Upcoming';
  };

  const sortedEntries = [...entries].sort((a: any, b: any) => {
    const order: Record<string, number> = { live: 0, upcoming: 1, completed: 2 };
    const aOrder = order[a.matches?.status] ?? 3;
    const bOrder = order[b.matches?.status] ?? 3;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return new Date(b.matches?.match_date || 0).getTime() - new Date(a.matches?.match_date || 0).getTime();
  });

  return (
    <Layout>
      <div className="space-y-6 pt-4">
        <div className="flex flex-col items-center text-center">
          <div className="w-20 h-20 rounded-full gradient-primary flex items-center justify-center mb-3">
            <User className="w-10 h-10 text-primary-foreground" />
          </div>
          <h1 className="font-display font-black text-xl text-foreground flex items-center gap-2">
            {profile?.username || 'Loading...'}
            <button onClick={handleEditOpen} className="text-muted-foreground hover:text-primary transition-colors">
              <Pencil className="w-4 h-4" />
            </button>
          </h1>
          <p className="text-sm text-muted-foreground">{user?.email}</p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[
            { icon: Trophy, label: 'Points', value: profile?.old_app_points || profile?.total_points || 0, onClick: undefined },
            { icon: Target, label: 'My Entries', value: teamCount, onClick: () => setEntriesOpen(!entriesOpen) },
            { icon: Calendar, label: 'Leagues', value: leagueCount, onClick: undefined },
          ].map(({ icon: Icon, label, value, onClick }) => (
            <div
              key={label}
              className={`gradient-card rounded-lg border border-border p-3 text-center ${onClick ? 'cursor-pointer hover:border-primary transition-colors' : ''}`}
              onClick={onClick}
            >
              <Icon className="w-5 h-5 text-primary mx-auto mb-1" />
              <p className="font-display font-black text-lg text-foreground">{value}</p>
              <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                {label}
                {onClick && (entriesOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
              </p>
            </div>
          ))}
        </div>

        {entriesOpen && (
          <div className="gradient-card rounded-lg border border-border p-4 space-y-2 animate-in slide-in-from-top-2">
            <h2 className="font-display font-bold text-foreground mb-2">My Entries</h2>
            {sortedEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No entries yet</p>
            ) : (
              sortedEntries.map((entry: any) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-background/50 border border-border cursor-pointer hover:border-primary transition-colors"
                  onClick={() => navigate(`/match/${entry.match_id}`)}
                >
                  <div>
                    <p className="font-display font-bold text-sm text-foreground">
                      {entry.matches?.team_a} vs {entry.matches?.team_b}
                    </p>
                    <p className={`text-xs font-medium ${statusColor(entry.matches?.status)}`}>
                      {statusLabel(entry.matches?.status)}
                    </p>
                  </div>
                  <div className="text-right">
                    {entry.matches?.status === 'upcoming' ? (
                      <span className="text-xs font-display font-bold text-yellow-400">Entered</span>
                    ) : (
                      <p className="font-display font-black text-lg text-secondary">
                        {entry.total_points?.toFixed(1) || '0.0'}
                      </p>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Scoring Guide */}
        <div className="gradient-card rounded-xl border border-border p-4">
          <button
            onClick={() => setScoringOpen(!scoringOpen)}
            className="w-full flex items-center justify-between"
          >
            <h3 className="font-display font-bold text-lg">Scoring Guide</h3>
            <ChevronDown className={cn(
              "w-5 h-5 transition-transform",
              scoringOpen && "rotate-180"
            )} />
          </button>

          {scoringOpen && (
            <div className="mt-4 space-y-4 animate-in slide-in-from-top-2">
              {/* Format Toggle */}
              <div className="flex gap-2">
                <button
                  onClick={() => setScoringFormat('t20')}
                  className={cn(
                    "flex-1 px-4 py-2 rounded-lg font-display font-semibold transition-all text-sm",
                    scoringFormat === 't20'
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  )}
                >
                  T20 / ODI
                </button>
                <button
                  onClick={() => setScoringFormat('test')}
                  className={cn(
                    "flex-1 px-4 py-2 rounded-lg font-display font-semibold transition-all text-sm",
                    scoringFormat === 'test'
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  )}
                >
                  Test Cricket
                </button>
              </div>

              {/* T20/ODI Scoring */}
              {scoringFormat === 't20' && (
                <div className="space-y-3">
                  <div>
                    <h4 className="font-display font-semibold mb-2 text-secondary text-sm">Batting</h4>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <div className="flex justify-between"><span>Run</span><span className="font-display font-bold text-secondary">+1</span></div>
                      <div className="flex justify-between"><span>Four</span><span className="font-display font-bold text-secondary">+4</span></div>
                      <div className="flex justify-between"><span>Six</span><span className="font-display font-bold text-secondary">+6</span></div>
                      <div className="flex justify-between"><span>Duck</span><span className="font-display font-bold text-destructive">-2</span></div>
                      <div className="flex justify-between"><span>25 runs</span><span className="font-display font-bold text-secondary">+8</span></div>
                      <div className="flex justify-between"><span>50 runs</span><span className="font-display font-bold text-secondary">+16</span></div>
                      <div className="flex justify-between"><span>100 runs</span><span className="font-display font-bold text-secondary">+32</span></div>
                      <div className="flex justify-between"><span>SR {'>'} 170</span><span className="font-display font-bold text-secondary">+6</span></div>
                      <div className="flex justify-between"><span>SR 150-170</span><span className="font-display font-bold text-secondary">+4</span></div>
                      <div className="flex justify-between"><span>SR 130-150</span><span className="font-display font-bold text-secondary">+2</span></div>
                      <div className="flex justify-between"><span>SR {'<'} 50</span><span className="font-display font-bold text-destructive">-6</span></div>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-display font-semibold mb-2 text-secondary text-sm">Bowling</h4>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <div className="flex justify-between"><span>Wicket</span><span className="font-display font-bold text-secondary">+30</span></div>
                      <div className="flex justify-between"><span>Maiden over</span><span className="font-display font-bold text-secondary">+12</span></div>
                      <div className="flex justify-between"><span>3 wickets</span><span className="font-display font-bold text-secondary">+4</span></div>
                      <div className="flex justify-between"><span>4 wickets</span><span className="font-display font-bold text-secondary">+12</span></div>
                      <div className="flex justify-between"><span>5 wickets</span><span className="font-display font-bold text-secondary">+28</span></div>
                      <div className="flex justify-between"><span>ER {'<'} 5</span><span className="font-display font-bold text-secondary">+6</span></div>
                      <div className="flex justify-between"><span>ER 5-6</span><span className="font-display font-bold text-secondary">+4</span></div>
                      <div className="flex justify-between"><span>ER 6-7</span><span className="font-display font-bold text-secondary">+2</span></div>
                      <div className="flex justify-between"><span>ER {'>'} 12</span><span className="font-display font-bold text-destructive">-6</span></div>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-display font-semibold mb-2 text-secondary text-sm">Fielding & Bonuses</h4>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <div className="flex justify-between"><span>Catch</span><span className="font-display font-bold text-secondary">+8</span></div>
                      <div className="flex justify-between"><span>Stumping</span><span className="font-display font-bold text-secondary">+12</span></div>
                      <div className="flex justify-between"><span>Direct run out</span><span className="font-display font-bold text-secondary">+12</span></div>
                      <div className="flex justify-between"><span>Indirect run out</span><span className="font-display font-bold text-secondary">+6</span></div>
                      <div className="flex justify-between"><span>Starting XI</span><span className="font-display font-bold text-secondary">+4</span></div>
                      <div className="flex justify-between"><span>Winning team</span><span className="font-display font-bold text-secondary">+5</span></div>
                      <div className="flex justify-between"><span>MOTM</span><span className="font-display font-bold text-secondary">+30</span></div>
                      <div className="flex justify-between"><span>Captain</span><span className="font-display font-bold text-secondary">2×</span></div>
                      <div className="flex justify-between"><span>Vice-Captain</span><span className="font-display font-bold text-secondary">1.5×</span></div>
                    </div>
                  </div>
                </div>
              )}

              {/* Test Scoring */}
              {scoringFormat === 'test' && (
                <div className="space-y-3">
                  <div>
                    <h4 className="font-display font-semibold mb-2 text-secondary text-sm">Batting</h4>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <div className="flex justify-between"><span>Run</span><span className="font-display font-bold text-secondary">+1</span></div>
                      <p className="text-[10px] italic opacity-60">No bonuses for boundaries, milestones, or strike rate</p>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-display font-semibold mb-2 text-secondary text-sm">Bowling</h4>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <div className="flex justify-between"><span>Wicket</span><span className="font-display font-bold text-secondary">+25</span></div>
                      <p className="text-[10px] italic opacity-60">No bonuses for maidens, wicket hauls, or economy rate</p>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-display font-semibold mb-2 text-secondary text-sm">Fielding & Bonuses</h4>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <div className="flex justify-between"><span>Catch</span><span className="font-display font-bold text-secondary">+8</span></div>
                      <div className="flex justify-between"><span>Stumping</span><span className="font-display font-bold text-secondary">+12</span></div>
                      <div className="flex justify-between"><span>Direct run out</span><span className="font-display font-bold text-secondary">+12</span></div>
                      <div className="flex justify-between"><span>Indirect run out</span><span className="font-display font-bold text-secondary">+6</span></div>
                      <div className="flex justify-between"><span>Starting XI</span><span className="font-display font-bold text-secondary">+4</span></div>
                      <div className="flex justify-between"><span>Captain</span><span className="font-display font-bold text-secondary">2×</span></div>
                      <div className="flex justify-between"><span>Vice-Captain</span><span className="font-display font-bold text-secondary">1.5×</span></div>
                      <p className="text-[10px] italic opacity-60">No winning team or MOTM bonus</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <Button
          variant="outline"
          onClick={handleSignOut}
          className="w-full border-border text-destructive font-display"
        >
          <LogOut className="w-4 h-4 mr-2" /> Sign Out
        </Button>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display">Edit Profile</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <label className="text-sm text-muted-foreground">Username</label>
            <Input
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="Enter new username"
              maxLength={30}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveUsername} disabled={saving || !newUsername.trim()}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
};

export default Profile;