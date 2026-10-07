package wstore

import (
	"context"
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// AppendDag persists a new TaskGroup row (db_dag) at version 1.
func AppendDag(ctx context.Context, dag *waveobj.TaskGroup) error {
	return DBInsert(ctx, dag)
}

// GetDag reads a TaskGroup by id from its db_dag row.
func GetDag(ctx context.Context, dagId string) (*waveobj.TaskGroup, error) {
	return DBMustGet[*waveobj.TaskGroup](ctx, dagId)
}

// GetDagShared is GetDag for a caller that only reads: the group is shared, not a copy (see selectShared).
func GetDagShared(ctx context.Context, dagId string) (*waveobj.TaskGroup, error) {
	dags, err := selectShared[*waveobj.TaskGroup](ctx, `SELECT oid, version FROM db_dag WHERE oid = ?`, dagId)
	if err != nil {
		return nil, err
	}
	if len(dags) == 0 {
		return nil, ErrNotFound
	}
	return dags[0], nil
}

// GetDagsByStatus lists every dag row with the given derived status (e.g. "running") — the watchdog's
// iteration set.
func GetDagsByStatus(ctx context.Context, status string) ([]*waveobj.TaskGroup, error) {
	return WithReadTxRtn(ctx, func(tx *TxWrap) ([]*waveobj.TaskGroup, error) {
		query := `SELECT oid, version, data FROM db_dag
			WHERE json_extract(data, '$.status') = ?
			ORDER BY json_extract(data, '$.updatedts') ASC`
		var rows []idDataType
		tx.Select(&rows, query, status)
		out := make([]*waveobj.TaskGroup, 0, len(rows))
		for _, row := range rows {
			obj, err := waveobj.FromJson(row.Data)
			if err != nil {
				return nil, err
			}
			waveobj.SetVersion(obj, row.Version)
			out = append(out, obj.(*waveobj.TaskGroup))
		}
		return out, nil
	})
}

// UpdateDag applies fn under the optimistic-concurrency version check and bumps Version.
func UpdateDag(ctx context.Context, dagId string, fn func(*waveobj.TaskGroup) error) error {
	return DBUpdateFnErr[*waveobj.TaskGroup](ctx, dagId, fn)
}

func GetDagsWithPendingCleanup(ctx context.Context) ([]*waveobj.TaskGroup, error) {
	return WithReadTxRtn(ctx, func(tx *TxWrap) ([]*waveobj.TaskGroup, error) {
		query := `SELECT oid, version, data FROM db_dag
			WHERE EXISTS (
				SELECT 1 FROM json_each(data, '$.tasks') AS task
				WHERE json_extract(task.value, '$.cleanuppending') = 1
				   OR json_extract(task.value, '$.cleanuperror') != ''
			)
			ORDER BY json_extract(data, '$.updatedts') ASC`
		var rows []idDataType
		tx.Select(&rows, query)
		out := make([]*waveobj.TaskGroup, 0, len(rows))
		for _, row := range rows {
			obj, err := waveobj.FromJson(row.Data)
			if err != nil {
				return nil, err
			}
			waveobj.SetVersion(obj, row.Version)
			out = append(out, obj.(*waveobj.TaskGroup))
		}
		return out, nil
	})
}

func CreateDagForRun(ctx context.Context, channelID string, runID string, proposed *waveobj.TaskGroup, transition func(*waveobj.Run) error) (dag *waveobj.TaskGroup, created bool, err error) {
	err = WithTx(ctx, func(tx *TxWrap) error {
		txCtx := tx.Context()
		run, txErr := GetRun(txCtx, channelID, runID)
		if txErr != nil {
			return fmt.Errorf("loading run: %w", txErr)
		}
		if run.DagORef != "" {
			existing, txErr := DBMustGet[*waveobj.TaskGroup](txCtx, run.DagORef)
			if txErr != nil {
				return txErr
			}
			dag = existing
			created = false
			return nil
		}
		if txErr := UpdateRun(txCtx, channelID, runID, func(r *waveobj.Run) error {
			if transition != nil {
				if err := transition(r); err != nil {
					return err
				}
			}
			r.DagORef = proposed.OID
			return nil
		}); txErr != nil {
			return txErr
		}
		if txErr := DBInsert(txCtx, proposed); txErr != nil {
			return txErr
		}
		dag = proposed
		created = true
		return nil
	})
	return dag, created, err
}
