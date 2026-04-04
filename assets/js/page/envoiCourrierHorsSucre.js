window.addEventListener('DOMContentLoaded', function () {
    document.querySelector('.btn-validate-form').addEventListener('click', evt => {
        evt.preventDefault()

        let form = $('#form-createCourrierHorsSucre');
        const valeurParam = document.getElementById('valeurParam').value
        const nomCourrierSuivant = document.getElementById('nomCourrierSuivant').value

        /*
         * CAS PARTICULIER SI LE COURRIER PRECEDENT EST UNE MISE EN DEMEURE :
         * ON AFFICHE QUE L'ETAPE DE LA CREANCE CHANGERA APRES LE TRAITEMENT JOURNALIER
         */
        if (valeurParam === 'WF.MISEDEMEURE') {
            alert('La nouvelle échéance courrier ' + nomCourrierSuivant + ' sera générée lors du traitement journalier (J+1).');
        }

        form.submit()
    })
})