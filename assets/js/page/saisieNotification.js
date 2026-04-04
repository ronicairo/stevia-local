document.addEventListener('DOMContentLoaded', () => {
    const motifNotifSelect = document.getElementById('notification_motifNotif')
    const textMotifField = document.getElementById('notification_textMotif')

    motifNotifSelect.addEventListener('change', ev => {
        const selectedOption = motifNotifSelect.options[motifNotifSelect.selectedIndex];
        const typeCnam = selectedOption.dataset.cnam === '1';

        const motif = document.querySelector(`.motif-${ev.target.value}`)?.value || '';
        textMotifField.value = motif.replace(/<br\s*\/?>/gi, "\n");

        textMotifField.disabled = typeCnam;
    });

    const defaultMotifStat = document.getElementById('hidden_motifStat')
    if (defaultMotifStat) {
        document.getElementById('notification_motifStat').value = defaultMotifStat.value
    }

    document.querySelectorAll('.duplicate-date').forEach(button => {
        button.addEventListener('click', function () {
            const container = this.closest('td');
            const input = container.querySelector('.date-mandatement');
            const selectedDate = input?.value;

            if (!selectedDate) {
                alert("Veuillez d'abord renseigner une date.");
                return;
            }

            document.querySelectorAll('.date-mandatement').forEach(otherInput => {
                otherInput.value = selectedDate;
            });
        });
    });
});