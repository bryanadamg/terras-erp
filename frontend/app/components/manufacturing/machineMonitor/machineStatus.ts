import { xpTitleGradients } from '../../shared/ModalWrapper';

/**
 * Card status strip -> the title bar of the window that card opens.
 *
 * Both read the same gradient table off this one map, so a green card can never
 * open a blue window (or a slightly different green one). It covers both
 * monitors: the loom's prep walk (STAGED -> DRAW_IN -> TUNING) and the dye
 * vessel's LOADED, because the two grids share their chrome even though they
 * share none of their arithmetic.
 */
export const MACHINE_TITLE_VARIANT: Record<string, 'primary' | 'success' | 'warning' | 'secondary'> = {
    RUNNING: 'success',
    STAGED: 'warning',
    DRAW_IN: 'primary',
    TUNING: 'primary',
    // A vessel with a batch loaded but not started: waiting on the floor, same
    // amber role STAGED plays on a loom.
    LOADED: 'warning',
    // A vessel whose next batch is having its shade matched. Blue, not amber: the
    // floor IS working on it, the same reason a loom's DRAW_IN is blue — LOADED is
    // the one that means nobody has touched it.
    MATCHING: 'primary',
    IDLE: 'secondary',
};

/** Gradient for a machine card's status strip. Grey when the status is unknown. */
export const machineStrip = (status: string): string => {
    const variant = MACHINE_TITLE_VARIANT[status];
    return variant ? xpTitleGradients[variant] : 'linear-gradient(to right, #808080, #a8a8a8)';
};

/**
 * Machine status -> a status the shared STATUS_FAMILY map already knows, so the
 * modern card's chip takes its colour from the same table every other list uses
 * rather than a per-view colour map.
 */
export const machineChipStatus = (status: string): string =>
    status === 'RUNNING' ? 'IN_PROGRESS'
        : status === 'IDLE' ? 'PENDING'
            // The vessel state and the run status spell colour matching differently
            // (a machine is MATCHING, a batch is COLOR_MATCHING); both take the one
            // family entry so the card strip and the run chip cannot drift apart.
            : status === 'MATCHING' ? 'COLOR_MATCHING'
                : status;
