document.addEventListener("DOMContentLoaded", function () {
    const form = document.getElementById("form-adresse");

    form.addEventListener("submit", function (e) {
        let totalIdentite = 0;
        let totalAdresse = 0;
        let totalLocalite = 0;

        // Champs identité
        const civilite = document.querySelector('[name$="[civilite]"]')?.value || '';
        const nom = document.querySelector('[name$="[nom]"]')?.value || '';
        const prenom = document.querySelector('[name$="[prenom]"]')?.value || '';
        totalIdentite = (civilite + ' ' + nom + ' ' + prenom).trim().length;

        if (totalIdentite > 38) {
            alert("La combinaison des civilité + nom + prénom ne doit pas dépasser 38 caractères afin de respecter les normes postales.");
            e.preventDefault();
            return;
        }

        // Champs adresse
        const numVoie = document.querySelector('[name$="[numVoie]"]')?.value || '';
        const cptNumVoie = document.querySelector('[name$="[cptNumVoie]"]')?.value || '';
        const typeVoie = document.querySelector('[name$="[typeVoie]"]')?.value || '';
        const libelleVoie = document.querySelector('[name$="[libelleVoie]"]')?.value || '';
        totalAdresse = (numVoie + ' ' + cptNumVoie + ' ' + typeVoie + ' ' + libelleVoie).trim().length;

        if (totalAdresse > 38) {
            alert("L'adresse (numéro voie + complément + type + nom voie) ne doit pas dépasser 38 caractères afin de respecter les normes postales.");
            e.preventDefault();
            return;
        }

        // Champs localité
        const codePostal = document.querySelector('[name$="[codePostal]"]')?.value || '';
        const commune = document.querySelector('[name$="[commune]"]')?.value || '';
        totalLocalite = (codePostal + ' ' + commune).trim().length;

        if (totalLocalite > 38) {
            alert("La combinaison des code postal + commune ne doit pas dépasser 38 caractères afin de respecter les normes postales.");
            e.preventDefault();
        }
    });
});